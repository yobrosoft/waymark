import { parseOverpass } from "@/lib/server/proxy-nearby";
import { buildOverpassQuery, OVERPASS_ENDPOINTS } from "@/lib/providers";
import type { GeocodeHit, NearbyCategory, NearbyPlace } from "@/lib/types";

export async function resolveGeocode(input: {
  query: string;
  cacheGet: (key: string) => Promise<GeocodeHit[] | undefined>;
  cacheSet: (key: string, value: GeocodeHit[]) => Promise<void>;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
}): Promise<{ ok: true; results: GeocodeHit[]; fromCache: boolean } | { ok: false; error: string }> {
  const query = input.query.trim();
  if (query.length < 2) return { ok: false, error: "Enter at least 2 characters to search." };
  if (query.length > 120) return { ok: false, error: "Search text is limited to 120 characters." };
  const key = query.toLowerCase();
  const cached = await input.cacheGet(key);
  if (cached) return { ok: true, results: cached, fromCache: true };
  const fetcher = input.fetcher ?? fetch;
  let response: Response;
  try {
    response = await fetcher(`/api/geocode?q=${encodeURIComponent(query)}`, {
      signal: input.signal,
      headers: { Accept: "application/json" },
    });
  } catch {
    if (input.signal?.aborted) return { ok: false, error: "cancelled" };
    return { ok: false, error: "The address search could not be reached. Coordinates were not changed." };
  }
  let body: { ok?: boolean; error?: string; results?: GeocodeHit[] } | null = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok || !body?.ok || !Array.isArray(body.results)) {
    return {
      ok: false,
      error: body?.error || `Address search failed (HTTP ${response.status}). Coordinates were not changed.`,
    };
  }
  await input.cacheSet(key, body.results);
  return { ok: true, results: body.results, fromCache: false };
}

export async function resolveNearby(input: {
  category: NearbyCategory;
  lat: number;
  lon: number;
  cacheGet: (key: string) => Promise<NearbyPlace[] | undefined>;
  cacheSet: (key: string, value: NearbyPlace[]) => Promise<void>;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
}): Promise<
  | { ok: true; places: NearbyPlace[]; fromCache: boolean }
  | { ok: false; error: string }
> {
  const key = `${input.category}|${input.lat.toFixed(4)}|${input.lon.toFixed(4)}`;
  const cached = await input.cacheGet(key);
  if (cached) return { ok: true, places: cached, fromCache: true };
  const query = buildOverpassQuery(input.category, { lat: input.lat, lon: input.lon });
  const fetcher = input.fetcher ?? fetch;
  const attempts: string[] = [];
  for (const endpoint of OVERPASS_ENDPOINTS) {
    let response: Response;
    try {
      response = await fetcher(endpoint, {
        method: "POST",
        signal: input.signal,
        headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: new URLSearchParams({ data: query }),
      });
    } catch {
      if (input.signal?.aborted) return { ok: false, error: "cancelled" };
      attempts.push(`${new URL(endpoint).host} unreachable`);
      continue;
    }
    if (!response.ok) {
      attempts.push(`${new URL(endpoint).host} HTTP ${response.status}`);
      continue;
    }
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      attempts.push(`${new URL(endpoint).host} unreadable`);
      continue;
    }
    const parsed = parseOverpass(body, { lat: input.lat, lon: input.lon });
    if (!parsed.ok) {
      attempts.push(`${new URL(endpoint).host} ${parsed.error}`);
      continue;
    }
    await input.cacheSet(key, parsed.places);
    return { ok: true, places: parsed.places, fromCache: false };
  }
  return {
    ok: false,
    error: `Nearby places are unavailable (${attempts.join("; ") || "no public Overpass response"}). Nothing was invented.`,
  };
}
