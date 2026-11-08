import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, type WaymarkConfig } from "@/server/config";
import { serveWaymark } from "@/server/app";
import { createLogger } from "@/server/log";
import { redirectAllowed } from "@/server/oauth";
import { createStore } from "@/server/store";
import { bangkokTrip } from "@/lib/seed";
import type { Trip } from "@/lib/types";
import { Writable } from "node:stream";

const NOW = "2026-11-08T12:00:00.000Z";

function config(dataFile: string, ports: { mcp: number; tailnet: number }): WaymarkConfig {
  return {
    bearer: "test-bearer-token-value",
    mcpHost: "127.0.0.1",
    mcpPort: ports.mcp,
    tailnetHost: "127.0.0.1",
    tailnetPort: ports.tailnet,
    publicOrigin: "https://waymark.example",
    dataFile,
    uiOrigins: ["http://127.0.0.1:3847"],
    proposalIntervalMs: 0,
    secretsFile: "",
  };
}

async function listen() {
  const dir = mkdtempSync(path.join(tmpdir(), "waymark-mcp-"));
  const dataFile = path.join(dir, "sessions.json");
  const store = createStore(dataFile, 0);
  const running = serveWaymark(config(dataFile, { mcp: 0, tailnet: 0 }), store, createLogger(new Writable({ write(_c, _e, cb) { cb(); } })));
  const up = (server: typeof running.mcp) =>
    new Promise<void>((resolve, reject) => {
      server.once("listening", () => resolve());
      server.once("error", reject);
    });
  const ready = Promise.all([up(running.mcp), up(running.tailnet)]);
  running.start();
  await ready;
  const mcp = running.mcp.address();
  const tailnet = running.tailnet.address();
  if (!mcp || typeof mcp === "string" || !tailnet || typeof tailnet === "string") throw new Error("no port");
  return {
    store,
    mcp: `http://127.0.0.1:${mcp.port}`,
    tailnet: `http://127.0.0.1:${tailnet.port}`,
    close: () => running.close(),
  };
}

const servers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (servers.length) await servers.pop()?.();
});

function note(trip: Trip, text: string): Trip {
  return { ...trip, stops: trip.stops.map((stop, index) => (index === 2 ? { ...stop, notes: text } : stop)) };
}

describe("waymark MCP", () => {
  it("keeps the browser API off the public port and the MCP off the tailnet port", async () => {
    const server = await listen();
    servers.push(server.close);
    const hidden = await fetch(`${server.mcp}/api/agent/trips`);
    expect(hidden.status).toBe(404);
    const mcp = await fetch(`${server.tailnet}/mcp`, { method: "POST" });
    expect(mcp.status).toBe(404);
    const open = await fetch(`${server.mcp}/mcp`, { method: "POST" });
    expect(open.status).toBe(401);
    expect(open.headers.get("www-authenticate")).toContain("waymark:plan");
  });

  it("lets Grok suggest a trip the browser can preview, without replacing it", async () => {
    const server = await listen();
    servers.push(server.close);
    const trip = bangkokTrip(NOW);
    const shared = await fetch(`${server.tailnet}/api/agent/trips/${trip.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json", origin: "http://127.0.0.1:3847" },
      body: JSON.stringify({ trip }),
    });
    expect(shared.status).toBe(200);
    const listed = await mcp(server.mcp, "tools/call", {
      name: "get_trip",
      arguments: {},
    });
    expect(listed.result.structuredContent.revision).toBe(1);
    const suggested = note(trip, "Ground level only.");
    const proposal = await mcp(server.mcp, "tools/call", {
      name: "suggest_trip",
      arguments: { basedOnRevision: 1, summary: "Clarified the Wat Arun note.", trip: suggested },
    });
    expect(proposal.result.isError).toBeUndefined();
    const view = await fetch(`${server.tailnet}/api/agent/trips/${trip.id}`);
    const body = (await view.json()) as { trip: Trip; pending: { trip: Trip; summary: string } | null };
    expect(body.trip.stops[2].notes).toBe(trip.stops[2].notes);
    expect(body.pending?.summary).toMatch(/Wat Arun/);
    expect(body.pending?.trip.stops[2].notes).toMatch(/Ground level/);
    const stale = await mcp(server.mcp, "tools/call", {
      name: "suggest_trip",
      arguments: { basedOnRevision: 0, summary: "Too old to apply.", trip },
    });
    expect(stale.result.isError).toBe(true);
  });

  it("rejects a browser origin that is not on the tailnet allow list", async () => {
    const server = await listen();
    servers.push(server.close);
    const response = await fetch(`${server.tailnet}/api/agent/trips`, { headers: { origin: "https://evil.example" } });
    expect(response.status).toBe(403);
  });

  it("rejects an OAuth redirect that is not Grok, Cursor, or the local callback", async () => {
    expect(redirectAllowed("https://grok.com/connectors-oauth-exchange-code")).toBe(true);
    expect(redirectAllowed("https://evil.example/steal?code=1")).toBe(false);
    const server = await listen();
    servers.push(server.close);
    const response = await fetch(`${server.mcp}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirect_uris: ["https://evil.example/steal"] }),
    });
    expect(response.status).toBe(400);
    const discovery = await fetch(`${server.mcp}/.well-known/oauth-authorization-server`);
    expect(discovery.status).toBe(200);
    const metadata = (await discovery.json()) as { scopes_supported: string[] };
    expect(metadata.scopes_supported).toEqual(["waymark:plan"]);
  });

  it("refuses a secrets file that other users can read", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "waymark-secrets-"));
    const file = path.join(dir, "secrets.env");
    writeFileSync(
      file,
      "MCP_BEARER_TOKEN=abcdefghijklmnopqrstuvwxyz\nMCP_PUBLIC_ORIGIN=https://waymark.example\n",
    );
    chmodSync(file, 0o644);
    expect(() =>
      loadConfig({
        env: { WAYMARK_MCP_SECRETS_FILE: file } as unknown as NodeJS.ProcessEnv,
        args: [],
      }),
    ).toThrow(/0600/);
  });
});

async function mcp(base: string, method: string, params: unknown) {
  const response = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      authorization: "Bearer test-bearer-token-value",
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as {
    result: { isError?: boolean; structuredContent: { revision: number } };
  };
}
