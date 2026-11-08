import type { IncomingMessage, ServerResponse } from "node:http";
import type { WaymarkConfig } from "@/server/config";
import { readBody, sendJSON, sendText } from "@/server/http";
import type { Store } from "@/server/store";

export function browserHandler(config: WaymarkConfig, store: Store) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const origin = header(req.headers.origin);
    if (origin && !config.uiOrigins.includes(origin)) return sendText(res, 403, "forbidden origin");
    if (origin) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("vary", "Origin");
      res.setHeader("access-control-allow-methods", "GET, PUT, POST, DELETE, OPTIONS");
      res.setHeader("access-control-allow-headers", "content-type");
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "cache-control": "no-store", "content-length": 0 });
      res.end();
      return;
    }
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const match = /^\/api\/agent\/trips(?:\/([^/]+))?(?:\/(decision))?$/.exec(url.pathname);
    if (!match) return sendText(res, 404, "not found");
    const tripId = decodeURIComponent(match[1] ?? "");
    const decision = match[2] === "decision";
    if (!tripId && req.method === "GET") {
      return sendJSON(res, 200, { ok: true, trips: await store.list() });
    }
    if (!tripId) return sendText(res, 404, "not found");
    if (decision) return decide(req, res, store, tripId);
    if (req.method === "GET") return readOne(res, store, tripId);
    if (req.method === "PUT") return share(req, res, store, tripId);
    if (req.method === "DELETE") {
      await store.end(tripId);
      return sendJSON(res, 200, { ok: true });
    }
    return sendText(res, 405, "method not allowed", { allow: "GET, PUT, DELETE" });
  };
}

async function readOne(res: ServerResponse, store: Store, tripId: string) {
  const session = await store.read(tripId);
  if (!session) return sendJSON(res, 200, { ok: true, shared: false });
  sendJSON(res, 200, {
    ok: true,
    tripId: session.tripId,
    tripName: session.accepted.name,
    revision: session.revision,
    trip: session.accepted,
    pending: session.pending,
  });
}

async function share(req: IncomingMessage, res: ServerResponse, store: Store, tripId: string) {
  let body: { trip?: unknown };
  try {
    body = JSON.parse(await readBody(req, 1 << 20)) as { trip?: unknown };
  } catch {
    return sendJSON(res, 400, { ok: false, error: "The body was not valid JSON." });
  }
  const trip = body.trip;
  if (!trip || typeof trip !== "object" || (trip as { id?: unknown }).id !== tripId) {
    return sendJSON(res, 400, { ok: false, error: "The trip id in the body must match the URL." });
  }
  const result = await store.share(trip);
  if (!result.ok) return sendJSON(res, result.status, { ok: false, error: result.error, issues: result.issues });
  sendJSON(res, 200, { ok: true, revision: result.revision, tripId: result.tripId, pending: result.pending, changed: result.changed });
}

async function decide(req: IncomingMessage, res: ServerResponse, store: Store, tripId: string) {
  if (req.method !== "POST") return sendText(res, 405, "method not allowed", { allow: "POST" });
  let body: { action?: unknown };
  try {
    body = JSON.parse(await readBody(req, 1 << 14)) as { action?: unknown };
  } catch {
    return sendJSON(res, 400, { ok: false, error: "The body was not valid JSON." });
  }
  if (body.action !== "apply" && body.action !== "dismiss") {
    return sendJSON(res, 400, { ok: false, error: "Action must be apply or dismiss." });
  }
  const result = await store.decide(tripId, body.action);
  if (!result.ok) return sendJSON(res, result.status, { ok: false, error: result.error });
  sendJSON(res, 200, { ok: true, revision: result.revision, trip: result.trip, pending: result.pending });
}

function header(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] : String(value || "");
}
