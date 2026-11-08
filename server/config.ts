import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_MCP_LISTEN = "127.0.0.1:8793";
const DEFAULT_TAILNET_LISTEN = "127.0.0.1:8794";
const RESERVED_PORTS = new Set([8787, 8788, 8791]);
const KNOWN_KEYS = new Set([
  "MCP_BEARER_TOKEN",
  "MCP_LISTEN",
  "MCP_PUBLIC_ORIGIN",
  "WAYMARK_TAILNET_LISTEN",
  "WAYMARK_DATA_FILE",
  "WAYMARK_UI_ORIGINS",
]);

export interface WaymarkConfig {
  bearer: string;
  mcpHost: string;
  mcpPort: number;
  tailnetHost: string;
  tailnetPort: number;
  publicOrigin: string;
  dataFile: string;
  uiOrigins: string[];
  proposalIntervalMs: number;
  secretsFile: string;
}

export function loadConfig({
  env = process.env,
  args = process.argv.slice(2),
  homedir = os.homedir(),
}: {
  env?: NodeJS.ProcessEnv;
  args?: string[];
  homedir?: string;
} = {}): WaymarkConfig {
  const flags = parseArgs(args);
  const secretsFile = flags.secrets || env.WAYMARK_MCP_SECRETS_FILE || "";
  const fromFile = secretsFile ? readSecrets(secretsFile) : {};
  const pick = (key: string) => env[key] || fromFile[key] || "";

  const mcp = parseListen(flags.listen || pick("MCP_LISTEN") || DEFAULT_MCP_LISTEN, "MCP_LISTEN");
  const tailnet = parseListen(pick("WAYMARK_TAILNET_LISTEN") || DEFAULT_TAILNET_LISTEN, "WAYMARK_TAILNET_LISTEN");
  if (mcp.port === tailnet.port) throw new Error("the browser listener must use a different port from the MCP listener");

  const bearer = pick("MCP_BEARER_TOKEN").trim();
  if (bearer.length < 16) throw new Error("MCP_BEARER_TOKEN is required (min 16 chars)");

  const publicOrigin = pick("MCP_PUBLIC_ORIGIN").replace(/\/$/, "");
  validatePublicOrigin(publicOrigin);
  if (!publicOrigin) throw new Error("MCP_PUBLIC_ORIGIN is required");

  const dataFile = path.resolve(pick("WAYMARK_DATA_FILE") || path.join(homedir, ".local", "share", "waymark-mcp", "sessions.json"));
  assertDataFile(dataFile);

  return {
    bearer,
    mcpHost: mcp.host === "localhost" ? "127.0.0.1" : mcp.host,
    mcpPort: mcp.port,
    tailnetHost: tailnet.host === "localhost" ? "127.0.0.1" : tailnet.host,
    tailnetPort: tailnet.port,
    publicOrigin,
    dataFile,
    uiOrigins: pick("WAYMARK_UI_ORIGINS")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
    proposalIntervalMs: 1000,
    secretsFile,
  };
}

function assertDataFile(file: string) {
  if (file.split(path.sep).includes("baileys-auth")) throw new Error("WAYMARK_DATA_FILE must not be inside baileys-auth");
  if (!fs.existsSync(file)) return;
  const st = fs.lstatSync(file);
  if (st.isSymbolicLink()) throw new Error("session file must not be a symlink");
  if (!st.isFile()) throw new Error("session file must be a regular file");
}

function parseArgs(args: string[]) {
  const out = { secrets: "", listen: "" };
  for (let i = 0; i < args.length; i += 1) {
    const raw = args[i];
    if (raw === "--") break;
    let name = raw;
    let value = "";
    const eq = raw.indexOf("=");
    if (raw.startsWith("--") && eq > 2) {
      name = raw.slice(0, eq);
      value = raw.slice(eq + 1);
    }
    if (name === "--secrets" || name === "--listen") {
      if (!value) {
        value = args[++i] ?? "";
        if (!value || value.startsWith("--")) throw new Error(`missing value for ${name}`);
      }
      if (name === "--secrets") out.secrets = value;
      else out.listen = value;
      continue;
    }
    if (raw.startsWith("-")) throw new Error(`unknown flag ${name}`);
    throw new Error("unexpected argument");
  }
  return out;
}

function parseListen(addr: string, label: string) {
  let host = "";
  let portText = "";
  if (addr.startsWith("[")) {
    const match = /^\[([^\]]+)\]:(\d+)$/.exec(addr);
    if (!match) throw new Error(`${label} ${addr} is not host:port`);
    host = match[1];
    portText = match[2];
  } else {
    const index = addr.lastIndexOf(":");
    if (index <= 0) throw new Error(`${label} ${addr} is not host:port`);
    host = addr.slice(0, index);
    portText = addr.slice(index + 1);
  }
  if (!/^\d+$/.test(portText)) throw new Error(`${label} ${addr} is not host:port`);
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`${label} ${addr} is not host:port`);
  if (RESERVED_PORTS.has(port)) throw new Error(`${label} must not use port ${port}`);
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`${label} ${addr} is not loopback`);
  }
  return { host, port };
}

function validatePublicOrigin(value: string) {
  if (!value) return;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("MCP_PUBLIC_ORIGIN must be an origin URL");
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error("MCP_PUBLIC_ORIGIN must be an origin URL");
  }
  if (url.protocol === "https:") return;
  const host = url.hostname;
  if (url.protocol === "http:" && (host === "127.0.0.1" || host === "localhost" || host === "::1")) return;
  throw new Error("MCP_PUBLIC_ORIGIN must be https");
}

function readSecrets(file: string): Record<string, string> {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(file);
  } catch {
    throw new Error("secrets file not found");
  }
  if (st.isSymbolicLink()) throw new Error("secrets file must not be a symlink");
  if (!st.isFile()) throw new Error("secrets file must be a regular file");
  if ((st.mode & 0o077) !== 0) throw new Error("secrets file must be mode 0600 (no group or world access)");
  return parseSecrets(fs.readFileSync(file, "utf8"));
}

function parseSecrets(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) throw new Error(`secrets file: invalid line ${i + 1}`);
    const key = line.slice(0, eq).trim();
    if (!key || /\s/.test(key)) throw new Error(`secrets file: invalid line ${i + 1}`);
    if (!KNOWN_KEYS.has(key)) throw new Error(`secrets file: unknown key on line ${i + 1}`);
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2) {
      const quote = value[0];
      if ((quote === '"' || quote === "'") && value.endsWith(quote)) value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}
