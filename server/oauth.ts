import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { WaymarkConfig } from "@/server/config";
import { escapeHtml, readBody, sendJSON, sendText } from "@/server/http";
import type { Logger } from "@/server/log";

export const OAUTH_SCOPE = "waymark:plan";
const CLIENT_ID = "grok";
const CODE_TTL_MS = 5 * 60 * 1000;
const ACCESS_TTL_MS = 60 * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_GRANTS = 32;

interface CodeGrant {
  challenge: string;
  redirect: string;
  clientID: string;
  expires: number;
}

interface RefreshGrant {
  clientID: string;
  expires: number;
}

export function newOAuth(config: WaymarkConfig, logger: Logger) {
  const codes = new Map<string, CodeGrant>();
  const access = new Map<string, number>();
  const refresh = new Map<string, RefreshGrant>();

  function tokenOK(got: string): boolean {
    if (secretOK(got, config.bearer)) return true;
    if (!got) return false;
    const now = Date.now();
    const exp = access.get(got);
    if (!exp || exp <= now) {
      if (exp) access.delete(got);
      return false;
    }
    return true;
  }

  function protectedResource(_req: IncomingMessage, res: ServerResponse) {
    const base = config.publicOrigin;
    sendJSON(res, 200, {
      resource: `${base}/mcp`,
      authorization_servers: [base],
      scopes_supported: [OAUTH_SCOPE],
      bearer_methods_supported: ["header"],
    });
  }

  function authorizationServer(_req: IncomingMessage, res: ServerResponse) {
    const base = config.publicOrigin;
    sendJSON(res, 200, {
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: [OAUTH_SCOPE],
    });
  }

  async function register(req: IncomingMessage, res: ServerResponse) {
    let body: { redirect_uris?: unknown };
    try {
      body = JSON.parse(await readBody(req, 1 << 14)) as { redirect_uris?: unknown };
    } catch {
      logRegister(logger, "invalid_client_metadata", []);
      return oauthErr(res, 400, "invalid_client_metadata");
    }
    const uris = body?.redirect_uris;
    if (!Array.isArray(uris) || uris.length === 0) {
      logRegister(logger, "invalid_client_metadata", []);
      return oauthErr(res, 400, "invalid_client_metadata");
    }
    for (const uri of uris) {
      if (typeof uri !== "string" || !redirectAllowed(uri)) {
        logRegister(logger, "invalid_redirect_uri", uris.filter((item) => typeof item === "string"));
        return oauthErr(res, 400, "invalid_redirect_uri");
      }
    }
    sendJSON(res, 201, {
      client_id: CLIENT_ID,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: OAUTH_SCOPE,
    });
  }

  async function authorize(req: IncomingMessage, res: ServerResponse) {
    const params = await readForm(req);
    const query = parseAuthRequest(params);
    if (!query) return sendText(res, 400, "authorization request rejected");
    if (!resourceOK(config.publicOrigin, query.resource)) return sendText(res, 400, "authorization request rejected");
    if (req.method === "GET") {
      const html = authorizePage({ ...query, scope: query.scope || OAUTH_SCOPE });
      const data = Buffer.from(html);
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-length": data.length,
        "x-content-type-options": "nosniff",
      });
      res.end(data);
      return;
    }
    if (!secretOK(params.get("token") || "", config.bearer)) return sendText(res, 401, "invalid token");
    const code = randomToken();
    const now = Date.now();
    prune(codes, access, refresh, now);
    codes.set(code, { challenge: query.challenge, redirect: query.redirect, clientID: query.clientID, expires: now + CODE_TTL_MS });
    const dest = new URL(query.redirect);
    dest.searchParams.set("code", code);
    dest.searchParams.set("state", query.state);
    res.writeHead(302, { location: dest.toString(), "cache-control": "no-store", "referrer-policy": "no-referrer" });
    res.end();
  }

  async function token(req: IncomingMessage, res: ServerResponse) {
    let params: URLSearchParams;
    try {
      params = await readForm(req);
    } catch {
      return oauthErr(res, 400, "invalid_request");
    }
    const grant = params.get("grant_type");
    if (grant === "authorization_code") return authorizationCode(params, res);
    if (grant === "refresh_token") return refreshToken(params, res);
    return oauthErr(res, 400, "unsupported_grant_type");
  }

  function authorizationCode(params: URLSearchParams, res: ServerResponse) {
    const code = params.get("code") || "";
    const now = Date.now();
    const grant = codes.get(code);
    if (grant) codes.delete(code);
    if (
      !grant ||
      grant.expires <= now ||
      grant.clientID !== CLIENT_ID ||
      params.get("client_id") !== CLIENT_ID ||
      grant.redirect !== (params.get("redirect_uri") || "") ||
      !pkceOK(params.get("code_verifier") || "", grant.challenge)
    ) {
      return oauthErr(res, 400, "invalid_grant");
    }
    issue(res);
  }

  function refreshToken(params: URLSearchParams, res: ServerResponse) {
    const raw = params.get("refresh_token") || "";
    const now = Date.now();
    const grant = refresh.get(raw);
    if (grant) refresh.delete(raw);
    const client = params.get("client_id") || "";
    if (!grant || grant.expires <= now || grant.clientID !== CLIENT_ID || (client && client !== CLIENT_ID)) {
      return oauthErr(res, 400, "invalid_grant");
    }
    issue(res);
  }

  function issue(res: ServerResponse) {
    const accessToken = randomToken();
    const refreshTokenValue = randomToken();
    const now = Date.now();
    prune(codes, access, refresh, now);
    access.set(accessToken, now + ACCESS_TTL_MS);
    refresh.set(refreshTokenValue, { clientID: CLIENT_ID, expires: now + REFRESH_TTL_MS });
    sendJSON(res, 200, {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: Math.floor(ACCESS_TTL_MS / 1000),
      refresh_token: refreshTokenValue,
      scope: OAUTH_SCOPE,
    });
  }

  return { tokenOK, protectedResource, authorizationServer, register, authorize, token };
}

export function redirectAllowed(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.username || url.password || url.search || url.hash) return false;
  const pathName = url.pathname.replace(/\/+$/, "");
  const port = explicitPort(raw);
  if (url.protocol === "https:" && url.hostname === "grok.com" && port === "" && pathName === "/connectors-oauth-exchange-code") {
    return true;
  }
  if (url.protocol === "https:" && url.hostname === "www.cursor.com" && port === "" && pathName === "/agents/mcp/oauth/callback") {
    return true;
  }
  if (
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
    port === "8793" &&
    pathName === "/callback"
  ) {
    return true;
  }
  return false;
}

export function secretOK(got: string, want: string): boolean {
  const left = Buffer.from(got);
  const right = Buffer.from(want);
  if (right.length === 0 || left.length !== right.length) {
    if (right.length > 0) timingSafeEqual(right, right);
    return false;
  }
  return timingSafeEqual(left, right);
}

function parseAuthRequest(params: URLSearchParams) {
  const query = {
    clientID: params.get("client_id") || "",
    redirect: params.get("redirect_uri") || "",
    state: params.get("state") || "",
    challenge: params.get("code_challenge") || "",
    method: params.get("code_challenge_method") || "",
    scope: params.get("scope") || "",
    resource: params.get("resource") || "",
    responseType: params.get("response_type") || "code",
  };
  if (query.clientID !== CLIENT_ID || query.responseType !== "code") return null;
  if (!query.state || query.state.length > 1024) return null;
  if (!redirectAllowed(query.redirect)) return null;
  if (query.method !== "S256" || query.challenge.length !== 43) return null;
  if (query.scope && query.scope !== OAUTH_SCOPE) return null;
  return query;
}

function resourceOK(base: string, resource: string): boolean {
  if (!resource) return true;
  const norm = (value: string) => value.replace(/\/+$/, "");
  const got = norm(resource);
  const origin = norm(base);
  return got === origin || got === `${origin}/mcp`;
}

function pkceOK(verifier: string, challenge: string): boolean {
  if (verifier.length < 43 || verifier.length > 128 || challenge.length !== 43) return false;
  const got = createHash("sha256").update(verifier).digest("base64url");
  return secretOK(got, challenge);
}

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

function prune(codes: Map<string, CodeGrant>, access: Map<string, number>, refresh: Map<string, RefreshGrant>, now: number) {
  for (const [key, value] of codes) if (value.expires <= now) codes.delete(key);
  for (const [key, exp] of access) if (exp <= now) access.delete(key);
  for (const [key, value] of refresh) if (value.expires <= now) refresh.delete(key);
  trim(codes);
  trim(access);
  trim(refresh);
}

function trim(map: Map<string, unknown>) {
  while (map.size > MAX_GRANTS) {
    const first = map.keys().next().value;
    if (first === undefined) break;
    map.delete(first);
  }
}

function logRegister(logger: Logger, reason: string, uris: string[]) {
  logger.info("oauth_register", { error: reason, redirects: uris.map((uri) => sanitizeRedirect(uri)).join(" ") });
}

function sanitizeRedirect(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "invalid";
  }
  let out = `${url.protocol}//${url.host}${url.pathname}`;
  if (url.search) out += " (has query)";
  if (url.hash) out += " (has fragment)";
  return out.length > 300 ? out.slice(0, 300) : out;
}

function authorizePage(query: { clientID: string; redirect: string; state: string; challenge: string; method: string; scope: string; resource: string }) {
  const fields: [string, string][] = [
    ["response_type", "code"],
    ["client_id", query.clientID],
    ["redirect_uri", query.redirect],
    ["state", query.state],
    ["code_challenge", query.challenge],
    ["code_challenge_method", query.method],
    ["scope", query.scope],
    ["resource", query.resource],
  ];
  const hidden = fields
    .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`)
    .join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Allow Grok</title></head>
<body>
<h1>Allow Grok to plan with Waymark</h1>
<p>Paste the Waymark bearer token from the secrets file on this Mac. This is not a Google key and not a trip. Grok can read trips you share from Waymark and send a suggestion. The suggestion is not saved on your phone or computer until you apply it there.</p>
<form method="post" action="/oauth/authorize">
${hidden}
<label>Bearer token <input type="password" name="token" autocomplete="off" maxlength="200" required></label>
<button type="submit">Allow</button>
</form>
</body>
</html>
`;
}

function explicitPort(raw: string): string {
  const match = /^[a-z][a-z0-9+.-]*:\/\/(?:[^/?#@]+@)?(?:\[[^\]]+\]|[^/:?#]+)(:\d+)?/i.exec(raw);
  if (!match || !match[1]) return "";
  return match[1].slice(1);
}

async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const params = new URLSearchParams(url.search);
  if (req.method === "POST") {
    const text = await readBody(req, 1 << 14);
    const body = new URLSearchParams(text);
    for (const [key, value] of body) params.set(key, value);
  }
  return params;
}

function oauthErr(res: ServerResponse, status: number, error: string) {
  sendJSON(res, status, { error });
}
