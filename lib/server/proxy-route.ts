import { isSamePlace, parseDecimalCoord } from "@/lib/geo";
import { APP_USER_AGENT, buildOsrmUrl } from "@/lib/providers";
import { parseOsrmBody } from "@/lib/routing";
import type { RoadMode } from "@/lib/types";
import { osrmQueue, recall, remember } from "@/lib/server/schedule";

const MODES = new Set<RoadMode>(["driving", "walking", "cycling"]);

function failure(status: number, error: string) {
  return { status, body: { ok: false as const, error } };
}

export async function proxyRoute(
  params: URLSearchParams,
  fetcher: typeof fetch = fetch,
  schedule: <T>(task: () => Promise<T>) => Promise<T> = (task) => osrmQueue.run(task),
  now = () => new Date().toISOString(),
): Promise<{ status: number; body: unknown }> {
  const mode = params.get("mode");
  if (!mode || !MODES.has(mode as RoadMode)) {
    return failure(400, "Choose driving, walking, or cycling. Public transport is requested from Google in the browser.");
  }
  const from = parseDecimalCoord(params.get("fromLat"), params.get("fromLon"));
  const to = parseDecimalCoord(params.get("toLat"), params.get("toLon"));
  if (!from || !to) {
    return failure(400, "The leg coordinates were not valid. No route was requested.");
  }
  if (isSamePlace(from, to)) {
    return { status: 200, body: { ok: true, samePlace: true } };
  }
  const legMode = mode as RoadMode;
  const cacheKey = buildOsrmUrl(legMode, from, to);
  const cached = recall(cacheKey);
  if (cached) return { status: cached.status, body: cached.body };

  let upstream: Response;
  try {
    upstream = await schedule(() =>
      fetcher(cacheKey, {
        headers: {
          Accept: "application/json",
          "User-Agent": APP_USER_AGENT,
          Referer: "https://routing.openstreetmap.de/",
        },
        signal: AbortSignal.timeout(12000),
      }),
    );
  } catch (error) {
    if (error instanceof Error && error.message === "RATE_LIMIT") {
      return failure(429, "Too many routing requests at once. Wait a moment and retry. No route was guessed.");
    }
    return failure(502, "The routing service could not be reached. No route line was drawn.");
  }

  const text = await upstream.text();
  if (text.length > 1_500_000) {
    return failure(502, "The routing response was too large to use. No line was drawn.");
  }
  if (!upstream.ok) {
    const message =
      upstream.status === 429
        ? "The public routing service is busy (HTTP 429). No route was estimated. Retry in a moment."
        : `The routing service failed (HTTP ${upstream.status}). No route line was drawn.`;
    return failure(upstream.status === 429 ? 429 : 502, message);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return failure(502, "The routing service returned an unreadable response. No route line was drawn.");
  }
  const parsed = parseOsrmBody(json, legMode, now());
  if (!parsed.ok) return failure(502, parsed.error);
  const body = { ok: true as const, route: parsed.route };
  remember(cacheKey, 200, body);
  return { status: 200, body };
}
