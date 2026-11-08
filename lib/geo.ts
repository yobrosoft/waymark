import type { Coord } from "@/lib/types";

export function haversineMeters(a: Coord, b: Coord): number {
  const radius = 6_371_000;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Same saved place, or two pins within 20 metres. Not a route. */
export function isSamePlace(
  a: Coord & { id?: string },
  b: Coord & { id?: string },
): boolean {
  if (a.id && b.id && a.id === b.id) return true;
  return haversineMeters(a, b) < 20;
}

export function parseDecimalCoord(
  latRaw: string | null,
  lonRaw: string | null,
): Coord | null {
  if (latRaw == null || lonRaw == null) return null;
  if (!/^-?\d+(\.\d+)?$/.test(latRaw) || !/^-?\d+(\.\d+)?$/.test(lonRaw)) {
    return null;
  }
  const lat = Number(latRaw);
  const lon = Number(lonRaw);
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

export function round5(value: number): string {
  return value.toFixed(5);
}
