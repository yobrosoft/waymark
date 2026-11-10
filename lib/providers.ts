import type { Coord, NearbyCategory, RoadMode } from "@/lib/types";

/** Maps JavaScript API console. The key is a browser key, restricted by HTTP referrer. */
export const GOOGLE_MAPS_KEY_URL =
  "https://console.cloud.google.com/apis/library/maps-backend.googleapis.com";

export const APP_USER_AGENT =
  "Waymark/1.0 (personal local-first trip map; https://www.openstreetmap.org/copyright)";

/**
 * FOSSGIS public OSRM demo (routing.openstreetmap.de).
 * Car, foot, and bike graphs. Not live traffic. One request per second.
 */
export const OSRM_ENDPOINTS: Record<RoadMode, { url: string; profile: "driving" | "foot" | "bike" }> = {
  driving: {
    url: "https://routing.openstreetmap.de/routed-car/route/v1/driving",
    profile: "driving",
  },
  walking: {
    url: "https://routing.openstreetmap.de/routed-foot/route/v1/foot",
    profile: "foot",
  },
  cycling: {
    url: "https://routing.openstreetmap.de/routed-bike/route/v1/bike",
    profile: "bike",
  },
};

export const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
] as const;

export const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

export const FIX_THE_MAP_URL = "https://www.openstreetmap.org/fixthemap";
export const OSM_COPYRIGHT_URL = "https://www.openstreetmap.org/copyright";

export const NEARBY_RADIUS_METERS = 700;

export const NEARBY_CATEGORIES: Record<
  NearbyCategory,
  { label: string; filters: [string, string][] }
> = {
  food: {
    label: "Food",
    filters: [
      ["amenity", "restaurant"],
      ["amenity", "fast_food"],
      ["amenity", "food_court"],
    ],
  },
  cafe: { label: "Cafes", filters: [["amenity", "cafe"]] },
  pharmacy: { label: "Pharmacy", filters: [["amenity", "pharmacy"]] },
  shops: {
    label: "Shops",
    filters: [
      ["shop", "convenience"],
      ["shop", "supermarket"],
    ],
  },
  sights: {
    label: "Sights",
    filters: [
      ["tourism", "attraction"],
      ["tourism", "museum"],
      ["tourism", "viewpoint"],
    ],
  },
};

export function buildOsrmUrl(mode: RoadMode, from: Coord, to: Coord): string {
  const endpoint = OSRM_ENDPOINTS[mode];
  const coordPath = `${from.lon},${from.lat};${to.lon},${to.lat}`;
  const url = new URL(`${endpoint.url}/${coordPath}`);
  url.searchParams.set("overview", "full");
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("steps", "false");
  url.searchParams.set("alternatives", "false");
  return url.toString();
}

export function buildOverpassQuery(category: NearbyCategory, center: Coord): string {
  const spec = NEARBY_CATEGORIES[category];
  const lines = spec.filters
    .map(
      ([key, value]) =>
        `  nwr["${key}"="${value}"](around:${NEARBY_RADIUS_METERS},${center.lat},${center.lon});`,
    )
    .join("\n");
  return `[out:json][timeout:12];\n(\n${lines}\n);\nout center 18;`;
}

export function buildNominatimUrl(query: string): string {
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "5");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("q", query);
  return url.toString();
}

export function googlePlaceUrl(name: string, address: string, coord: Coord): string {
  const text = `${name} ${address}`.trim();
  const query = text || `${coord.lat},${coord.lon}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export function googleDirectionsUrl(
  from: Coord,
  to: Coord,
  travelMode: "driving" | "walking" | "bicycling" | "transit",
): string {
  const params = new URLSearchParams({
    api: "1",
    origin: `${from.lat},${from.lon}`,
    destination: `${to.lat},${to.lon}`,
    travelmode: travelMode,
  });
  if (travelMode === "driving" || travelMode === "transit") {
    params.set("avoid", "ferries");
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function routeApiPath(mode: RoadMode, from: Coord, to: Coord): string {
  const params = new URLSearchParams({
    mode,
    fromLat: String(from.lat),
    fromLon: String(from.lon),
    toLat: String(to.lat),
    toLon: String(to.lon),
  });
  return `/api/route?${params.toString()}`;
}
