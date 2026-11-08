import { haversineMeters, parseDecimalCoord } from "@/lib/geo";
import {
  APP_USER_AGENT,
  buildOverpassQuery,
  NEARBY_CATEGORIES,
  OVERPASS_ENDPOINTS,
} from "@/lib/providers";
import type { NearbyCategory, NearbyPlace } from "@/lib/types";
import { overpassQueue } from "@/lib/server/schedule";

function failure(status: number, error: string) {
  return { status, body: { ok: false as const, error } };
}

export function parseOverpass(
  body: unknown,
  center: { lat: number; lon: number },
): { ok: true; places: NearbyPlace[] } | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Nearby places came back unreadable. None were invented." };
  }
  const record = body as { elements?: unknown; remark?: unknown };
  if (!Array.isArray(record.elements)) {
    const remark = typeof record.remark === "string" ? record.remark.slice(0, 160) : "no elements";
    return { ok: false, error: `Nearby search did not return places (${remark}). None were invented.` };
  }
  const places: NearbyPlace[] = [];
  for (const element of record.elements) {
    if (!element || typeof element !== "object") continue;
    const item = element as {
      type?: unknown;
      id?: unknown;
      lat?: unknown;
      lon?: unknown;
      center?: { lat?: unknown; lon?: unknown };
      tags?: Record<string, string>;
    };
    const lat = Number(item.lat ?? item.center?.lat);
    const lon = Number(item.lon ?? item.center?.lon);
    const name = item.tags?.name || item.tags?.["name:en"] || item.tags?.brand;
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const type = item.type === "way" || item.type === "relation" || item.type === "node" ? item.type : "node";
    const id = Number(item.id);
    if (!Number.isFinite(id)) continue;
    const kind = item.tags?.amenity || item.tags?.shop || item.tags?.tourism || "place";
    places.push({
      id: `${type}/${id}`,
      name: name.slice(0, 120),
      kind,
      lat,
      lon,
      straightLineMeters: Math.round(haversineMeters(center, { lat, lon })),
      osmUrl: `https://www.openstreetmap.org/${type}/${id}`,
    });
  }
  places.sort((a, b) => a.straightLineMeters - b.straightLineMeters);
  return { ok: true, places: places.slice(0, 12) };
}

async function queryEndpoint(
  endpoint: string,
  query: string,
  fetcher: typeof fetch,
): Promise<{ ok: true; json: unknown } | { ok: false; detail: string }> {
  try {
    const response = await fetcher(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "User-Agent": APP_USER_AGENT,
      },
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return { ok: false, detail: `HTTP ${response.status}` };
    const json: unknown = JSON.parse(await response.text());
    return { ok: true, json };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return { ok: false, detail: timedOut ? "timed out" : "unreachable" };
  }
}

export async function proxyNearby(
  params: URLSearchParams,
  fetcher: typeof fetch = fetch,
  schedule: <T>(task: () => Promise<T>) => Promise<T> = (task) => overpassQueue.run(task),
): Promise<{ status: number; body: unknown }> {
  const category = params.get("category");
  if (!category || !(category in NEARBY_CATEGORIES)) {
    return failure(400, "Choose a nearby category. Places were not guessed.");
  }
  const center = parseDecimalCoord(params.get("lat"), params.get("lon"));
  if (!center) return failure(400, "The map pin coordinates were not valid.");
  const query = buildOverpassQuery(category as NearbyCategory, center);
  try {
    return await schedule(async () => {
      const attempts: string[] = [];
      for (const endpoint of OVERPASS_ENDPOINTS) {
        const result = await queryEndpoint(endpoint, query, fetcher);
        if (result.ok) {
          const parsed = parseOverpass(result.json, center);
          if (!parsed.ok) return failure(502, parsed.error);
          return {
            status: 200,
            body: {
              ok: true as const,
              places: parsed.places,
              radiusMeters: 700,
              distance: "straight-line",
            },
          };
        }
        attempts.push(`${new URL(endpoint).host} ${result.detail}`);
        if (!/HTTP 5|timed out|unreachable/.test(result.detail) && !result.detail.includes("429")) {
          break;
        }
      }
      return failure(
        502,
        `Nearby places could not be loaded from the public Overpass service (${attempts.join("; ")}). Nothing was invented.`,
      );
    });
  } catch (error) {
    if (error instanceof Error && error.message === "RATE_LIMIT") {
      return failure(429, "Nearby search is rate limited. Wait a moment and retry. Nothing was invented.");
    }
    return failure(502, "Nearby search failed. Nothing was invented.");
  }
}
