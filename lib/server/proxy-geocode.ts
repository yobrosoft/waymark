import { APP_USER_AGENT, buildNominatimUrl } from "@/lib/providers";
import type { GeocodeHit } from "@/lib/types";
import { nominatimQueue, recall, remember } from "@/lib/server/schedule";

function failure(status: number, error: string) {
  return { status, body: { ok: false as const, error } };
}

export function parseNominatim(body: unknown): { ok: true; results: GeocodeHit[] } | { ok: false; error: string } {
  if (!Array.isArray(body)) {
    return { ok: false, error: "The geocoder returned an unexpected response. The coordinates were not changed." };
  }
  const results: GeocodeHit[] = [];
  for (const item of body.slice(0, 5)) {
    if (!item || typeof item !== "object") continue;
    const record = item as { display_name?: unknown; lat?: unknown; lon?: unknown };
    const lat = Number(record.lat);
    const lon = Number(record.lon);
    const label = typeof record.display_name === "string" ? record.display_name : "";
    if (!label || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    results.push({ label: label.slice(0, 240), lat, lon });
  }
  return { ok: true, results };
}

export async function proxyGeocode(
  query: string,
  fetcher: typeof fetch = fetch,
  schedule: <T>(task: () => Promise<T>) => Promise<T> = (task) => nominatimQueue.run(task),
): Promise<{ status: number; body: unknown }> {
  const q = query.trim();
  if (q.length < 2) return failure(400, "Enter at least 2 characters to search.");
  if (q.length > 120) return failure(400, "Search text is limited to 120 characters.");
  const url = buildNominatimUrl(q);
  const cached = recall(`geo:${q.toLowerCase()}`);
  if (cached) return { status: cached.status, body: cached.body };
  let upstream: Response;
  try {
    upstream = await schedule(() =>
      fetcher(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": APP_USER_AGENT,
          "Accept-Language": "en",
        },
        signal: AbortSignal.timeout(12000),
      }),
    );
  } catch (error) {
    if (error instanceof Error && error.message === "RATE_LIMIT") {
      return failure(429, "Address search is busy. Wait a moment and try again. Coordinates were not changed.");
    }
    return failure(502, "The address search could not be reached. Coordinates were not changed.");
  }
  if (!upstream.ok) {
    return failure(
      502,
      `Address search failed (HTTP ${upstream.status}). Coordinates were not changed.`,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(await upstream.text());
  } catch {
    return failure(502, "The address search returned an unreadable response. Coordinates were not changed.");
  }
  const parsed = parseNominatim(json);
  if (!parsed.ok) return failure(502, parsed.error);
  const body = { ok: true as const, results: parsed.results };
  remember(`geo:${q.toLowerCase()}`, 200, body);
  return { status: 200, body };
}
