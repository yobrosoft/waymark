import type { IncomingMessage, ServerResponse } from "node:http";
import type { WaymarkConfig } from "@/server/config";
import { accepts, bearerFrom, mediaType, readBody, sendJSON, sendText } from "@/server/http";
import type { Logger } from "@/server/log";
import { OAUTH_SCOPE, newOAuth } from "@/server/oauth";
import type { Store } from "@/server/store";

const INSTRUCTIONS =
  "Waymark trips shared from the app on this Mac. list_trips shows those trips. get_trip returns the saved trip and its revision. " +
  "suggest_trip sends a full updated trip with basedOnRevision set to that revision and a short summary. " +
  "The saved trip is not replaced. The person previews and applies the suggestion in Waymark, on this computer or a phone on the same tailnet. " +
  "A conflict means the saved trip changed; read it again and send a new suggestion. Do not invent stops that were not discussed.";

const PROTOCOL_VERSIONS = new Set(["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"]);

const TOOLS = [
  {
    name: "list_trips",
    description: "Trips currently shared from Waymark. Each item has tripId, name, revision, and any waiting suggestion summary.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, title: "List shared trips" },
  },
  {
    name: "get_trip",
    description:
      "Read one shared trip. tripId is optional when only one trip is shared. Returns the saved trip and its revision. A waiting suggestion is summarized, not returned.",
    inputSchema: {
      type: "object",
      properties: { tripId: { type: "string", description: "Trip id from list_trips." } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, title: "Read a trip" },
  },
  {
    name: "suggest_trip",
    description:
      "Store a suggested replacement for a shared trip. This does not change the saved trip. basedOnRevision must be the revision from get_trip. summary is 3 to 500 characters. trip is the full version 1 trip with the same id.",
    inputSchema: {
      type: "object",
      properties: {
        tripId: { type: "string" },
        basedOnRevision: { type: "integer", minimum: 1 },
        summary: { type: "string", minLength: 3, maxLength: 500 },
        trip: { type: "object", additionalProperties: true },
      },
      required: ["basedOnRevision", "summary", "trip"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, title: "Suggest a trip" },
  },
];

export function mcpHandler(config: WaymarkConfig, store: Store, logger: Logger) {
  const oauth = newOAuth(config, logger);
  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const pathname = url.pathname;
    if (
      pathname === "/.well-known/oauth-authorization-server" ||
      pathname === "/.well-known/oauth-protected-resource" ||
      pathname === "/.well-known/oauth-protected-resource/mcp"
    ) {
      if (req.method !== "GET") return sendText(res, 405, "method not allowed", { allow: "GET" });
      if (pathname === "/.well-known/oauth-authorization-server") return oauth.authorizationServer(req, res);
      return oauth.protectedResource(req, res);
    }
    if (pathname === "/oauth/register") {
      if (req.method !== "POST") return sendText(res, 405, "method not allowed", { allow: "POST" });
      return oauth.register(req, res);
    }
    if (pathname === "/oauth/authorize") {
      if (req.method !== "GET" && req.method !== "POST") return sendText(res, 405, "method not allowed", { allow: "GET, POST" });
      return oauth.authorize(req, res);
    }
    if (pathname === "/oauth/token") {
      if (req.method !== "POST") return sendText(res, 405, "method not allowed", { allow: "POST" });
      return oauth.token(req, res);
    }
    if (pathname === "/mcp") return handleMcp(req, res, store, config, oauth);
    return sendText(res, 404, "not found");
  };
}

async function handleMcp(
  req: IncomingMessage,
  res: ServerResponse,
  store: Store,
  config: WaymarkConfig,
  oauth: ReturnType<typeof newOAuth>,
) {
  const origin = header(req.headers.origin);
  if (origin) {
    if (!config.uiOrigins.includes(origin)) return sendText(res, 403, "forbidden origin");
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "Origin");
  }
  if (!oauth.tokenOK(bearerFrom(req.headers.authorization))) {
    return sendText(res, 401, "unauthorized", { "www-authenticate": wwwAuthenticate(config) });
  }
  if (req.method !== "POST") return sendText(res, 405, "method not allowed", { allow: "POST" });
  if (mediaType(req.headers["content-type"]) !== "application/json") return sendText(res, 415, "Content-Type must be application/json");
  const accept = accepts(req.headers.accept);
  if (!accept.json || !accept.stream) return sendText(res, 400, "Accept must contain both application/json and text/event-stream");
  const protocol = header(req.headers["mcp-protocol-version"]);
  if (protocol && !/^\d{4}-\d{2}-\d{2}$/.test(protocol)) return sendText(res, 400, "unsupported protocol version");

  const text = await readBody(req, 1 << 20);
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    return sendJSON(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
  }
  const messages = Array.isArray(parsed) ? parsed : [parsed];
  if (!parsed || messages.length === 0) {
    return sendJSON(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } });
  }
  const responses = [];
  for (const message of messages) {
    const response = await dispatch(store, message);
    if (response) responses.push(response);
  }
  if (responses.length === 0) {
    res.writeHead(202, { "cache-control": "no-store", "content-length": 0 });
    res.end();
    return;
  }
  sendJSON(res, 200, Array.isArray(parsed) ? responses : responses[0]);
}

async function dispatch(store: Store, message: unknown) {
  if (!message || typeof message !== "object" || (message as { jsonrpc?: string }).jsonrpc !== "2.0") {
    return rpcError(null, -32600, "Invalid Request");
  }
  const record = message as { id?: unknown; method?: string; params?: Record<string, unknown> };
  if (!Object.prototype.hasOwnProperty.call(message, "id")) return null;
  const id = record.id ?? null;
  switch (record.method) {
    case "initialize":
      return { jsonrpc: "2.0", id, result: initializeResult(record.params ?? {}) };
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "notifications/initialized":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
    case "tools/call":
      return callTool(store, id, record.params ?? {});
    case "resources/list":
      return { jsonrpc: "2.0", id, result: { resources: [] } };
    case "prompts/list":
      return { jsonrpc: "2.0", id, result: { prompts: [] } };
    default:
      return rpcError(id, -32601, "Method not found");
  }
}

function initializeResult(params: Record<string, unknown>) {
  const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
  return {
    protocolVersion: PROTOCOL_VERSIONS.has(requested) ? requested : "2025-06-18",
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: "waymark", title: "Waymark", version: "0.1.0" },
    instructions: INSTRUCTIONS,
  };
}

async function callTool(store: Store, id: unknown, params: Record<string, unknown>) {
  const name = params.name;
  const args = params.arguments ?? {};
  if (typeof name !== "string" || !args || typeof args !== "object" || Array.isArray(args)) return rpcError(id, -32602, "Invalid params");
  try {
    const data = await runTool(store, name, args as Record<string, unknown>);
    return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data } };
  } catch (err) {
    const message = err instanceof ToolError ? err.message : "request failed";
    return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: message }], isError: true } };
  }
}

async function runTool(store: Store, name: string, args: Record<string, unknown>) {
  if (name === "list_trips") return { trips: await store.list() };
  if (name === "get_trip") return readTrip(store, typeof args.tripId === "string" ? args.tripId : "");
  if (name === "suggest_trip") return suggest(store, args);
  throw new ToolError("unknown tool");
}

async function readTrip(store: Store, tripId: string) {
  const trips = await store.list();
  const id = tripId || (trips.length === 1 ? trips[0].tripId : "");
  if (!id) {
    if (trips.length === 0) throw new ToolError("No trip is shared. Share one from Waymark first.");
    throw new ToolError(`More than one trip is shared. Pass tripId. Choices: ${trips.map((trip) => trip.tripId).join(", ")}`);
  }
  const session = await store.read(id);
  if (!session) throw new ToolError("That trip is not shared.");
  return {
    tripId: session.tripId,
    name: session.accepted.name,
    revision: session.revision,
    trip: session.accepted,
    pending: session.pending ? { summary: session.pending.summary, stale: session.pending.stale } : null,
  };
}

async function suggest(store: Store, args: Record<string, unknown>) {
  const trips = await store.list();
  const tripId = typeof args.tripId === "string" && args.tripId ? args.tripId : trips.length === 1 ? trips[0].tripId : "";
  if (!tripId) throw new ToolError(trips.length === 0 ? "No trip is shared." : "Pass tripId.");
  const result = await store.propose(tripId, {
    basedOnRevision: args.basedOnRevision,
    summary: args.summary,
    trip: args.trip,
  });
  if (!result.ok) throw new ToolError(result.error);
  return { ok: true, tripId, revision: result.revision, replaced: result.replaced, summary: result.summary };
}

function wwwAuthenticate(config: WaymarkConfig): string {
  return `Bearer realm="waymark", resource_metadata="${config.publicOrigin}/.well-known/oauth-protected-resource/mcp", scope="${OAUTH_SCOPE}"`;
}

function header(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] : String(value || "");
}

function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

class ToolError extends Error {}
