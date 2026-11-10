import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import { parseTransitRoute, type TransitRouteInput, type TransitStepInput } from "@/lib/transit";
import type { Coord, RoutePayload } from "@/lib/types";

const ENV_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() ?? "";

async function loadMapsBrowserKey(): Promise<string> {
  if (ENV_KEY) return ENV_KEY;
  try {
    const response = await fetch("/config.json", { cache: "no-store" });
    if (response.ok) {
      const body = (await response.json()) as { mapsKey?: unknown };
      if (typeof body.mapsKey === "string" && body.mapsKey.trim()) return body.mapsKey.trim();
    }
  } catch {
    /* Local dev has no config file. */
  }
  try {
    return window.localStorage.getItem("waymark-google-maps-key")?.trim() ?? "";
  } catch {
    return "";
  }
}

function transitFailure(err: unknown): string {
  const text = err instanceof Error ? err.message : "";
  const upper = text.toUpperCase();
  if (upper.includes("ZERO_RESULTS") || upper.includes("NOT_FOUND")) {
    return "Google has no public transport route between these stops. No line was drawn.";
  }
  if (upper.includes("OVER_QUERY") || upper.includes("RESOURCE_EXHAUSTED")) {
    return "Google's transit service is busy. No route was estimated.";
  }
  if (
    upper.includes("REQUEST_DENIED") ||
    upper.includes("PERMISSION_DENIED") ||
    upper.includes("API_KEY") ||
    upper.includes("ROUTES")
  ) {
    return "Google refused public transport directions. The Maps key needs the Routes API for this site.";
  }
  return "Public transport directions failed. No line was drawn.";
}

function stepFromGoogle(step: google.maps.routes.RouteLegStep): TransitStepInput {
  const line = step.transitDetails?.transitLine;
  const name = line?.shortName?.trim() || line?.name?.trim() || "";
  return { travelMode: step.travelMode ?? "", line: name };
}

export async function fetchGoogleTransit(input: {
  from: Coord;
  to: Coord;
  departAt: Date;
  note: string;
  fetchedAt?: string;
  signal?: AbortSignal;
}): Promise<{ ok: true; route: RoutePayload } | { ok: false; error: string }> {
  if (input.signal?.aborted) return { ok: false, error: "cancelled" };
  const key = await loadMapsBrowserKey();
  if (!key) {
    return { ok: false, error: "Google Maps has no key here, so public transport directions were not requested." };
  }
  try {
    setOptions({ key, v: "weekly" });
  } catch {
    /* The map already configured this loader. */
  }
  try {
    const routes = (await importLibrary("routes")) as google.maps.RoutesLibrary;
    if (input.signal?.aborted) return { ok: false, error: "cancelled" };
    const { Route } = routes;
    const response = await Route.computeRoutes({
      origin: { lat: input.from.lat, lng: input.from.lon },
      destination: { lat: input.to.lat, lng: input.to.lon },
      travelMode: "TRANSIT",
      departureTime: input.departAt,
      polylineQuality: "HIGH_QUALITY",
      fields: ["distanceMeters", "durationMillis", "path", "warnings", "legs"],
    });
    const route = response.routes?.[0];
    if (!route) return { ok: false, error: "Google has no public transport route between these stops. No line was drawn." };
    const steps = (route.legs ?? []).flatMap((leg) => (leg.steps ?? []).map(stepFromGoogle));
    const body: TransitRouteInput = {
      distanceMeters: route.distanceMeters ?? Number.NaN,
      durationMillis: route.durationMillis ?? Number.NaN,
      path: (route.path ?? []).map((point) => ({ lat: point.lat, lng: point.lng })),
      steps,
      warnings: route.warnings,
    };
    return parseTransitRoute(body, input.fetchedAt ?? new Date().toISOString(), input.note);
  } catch (err) {
    if (input.signal?.aborted) return { ok: false, error: "cancelled" };
    return { ok: false, error: transitFailure(err) };
  }
}
