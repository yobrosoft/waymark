import { isSamePlace, round5 } from "@/lib/geo";
import { buildOsrmUrl } from "@/lib/providers";
import type { Coord, LegMode, LineStringGeometry, RoutePayload, RouteView } from "@/lib/types";

export const ROUTE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const PROFILES: Record<LegMode, RoutePayload["profile"]> = {
  driving: "driving",
  walking: "foot",
  cycling: "bike",
};

export function routeCacheKey(mode: LegMode, from: Coord, to: Coord): string {
  return `v1|${mode}|${round5(from.lon)},${round5(from.lat)}|${round5(to.lon)},${round5(to.lat)}`;
}

export function routeLine(view: RouteView): LineStringGeometry | null {
  if (view.status !== "ready") return null;
  return view.route.geometry;
}

function pair(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const lon = value[0];
  const lat = value[1];
  if (typeof lon !== "number" || typeof lat !== "number") return null;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return [lon, lat];
}

export function parseOsrmBody(
  body: unknown,
  mode: LegMode,
  fetchedAt: string,
): { ok: true; route: RoutePayload } | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return {
      ok: false,
      error: "The routing service returned an unreadable response. No route line was drawn.",
    };
  }
  const record = body as {
    code?: unknown;
    message?: unknown;
    routes?: { distance?: unknown; duration?: unknown; geometry?: { type?: unknown; coordinates?: unknown } }[];
  };
  if (record.code !== "Ok") {
    const detail = typeof record.message === "string" ? record.message : String(record.code ?? "no route");
    return {
      ok: false,
      error: `No road route from the routing service (${detail}). A straight line was not substituted.`,
    };
  }
  const route = record.routes?.[0];
  const raw = route?.geometry?.coordinates;
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 20000) {
    return {
      ok: false,
      error: "The routing service did not return usable road geometry. No estimated line was drawn.",
    };
  }
  const coordinates: [number, number][] = [];
  for (const item of raw) {
    const next = pair(item);
    if (!next) {
      return {
        ok: false,
        error: "The routing service returned a coordinate this app could not trust. No line was drawn.",
      };
    }
    coordinates.push(next);
  }
  if (
    typeof route?.distance !== "number" ||
    typeof route?.duration !== "number" ||
    !Number.isFinite(route.distance) ||
    !Number.isFinite(route.duration) ||
    route.distance < 0 ||
    route.duration < 0
  ) {
    return {
      ok: false,
      error: "The routing service omitted distance or duration. Those values were not guessed.",
    };
  }
  return {
    ok: true,
    route: {
      provider: "fossgis-osrm",
      profile: PROFILES[mode],
      mode,
      distanceMeters: route.distance,
      durationSeconds: route.duration,
      geometry: { type: "LineString", coordinates },
      traffic: "not-live",
      fetchedAt,
    },
  };
}

export async function resolveRoute(input: {
  samePlace: boolean;
  mode: LegMode;
  from: Coord;
  to: Coord;
  fetchedAt?: string;
  now?: number;
  signal?: AbortSignal;
  cacheGet: (key: string) => Promise<RoutePayload | undefined>;
  cacheSet: (key: string, value: RoutePayload) => Promise<void>;
  fetcher?: typeof fetch;
}): Promise<Exclude<RouteView, { status: "loading" | "idle" }>> {
  if (input.samePlace || isSamePlace(input.from, input.to)) {
    return { status: "same-place" };
  }
  const key = routeCacheKey(input.mode, input.from, input.to);
  const cached = await input.cacheGet(key);
  if (cached) return { status: "ready", route: cached, fromCache: true };
  const fetcher = input.fetcher ?? fetch;
  let response: Response;
  try {
    response = await fetcher(buildOsrmUrl(input.mode, input.from, input.to), {
      signal: input.signal,
      headers: { Accept: "application/json" },
    });
  } catch {
    if (input.signal?.aborted) return { status: "error", message: "cancelled", cancelled: true };
    return {
      status: "error",
      message: "The routing service could not be reached. No route line was drawn.",
    };
  }
  if (!response.ok) {
    const message =
      response.status === 429
        ? "The public routing service is busy (HTTP 429). No route was estimated."
        : `The routing service failed (HTTP ${response.status}). No route line was drawn.`;
    return { status: "error", message };
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const parsed = parseOsrmBody(body, input.mode, input.fetchedAt ?? new Date().toISOString());
  if (!parsed.ok) return { status: "error", message: parsed.error };
  await input.cacheSet(key, parsed.route);
  return { status: "ready", route: parsed.route, fromCache: false };
}
