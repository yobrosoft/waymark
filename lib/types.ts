export const SCHEMA_VERSION = 1 as const;

export type TripStatus = "proposed" | "draft" | "confirmed";
export type StopStatus = "proposed" | "confirmed" | "optional" | "buffer";
export type LegMode = "driving" | "walking" | "cycling" | "transit";
export type RoadMode = Exclude<LegMode, "transit">;

export interface Day {
  id: string;
  date: string;
  title: string;
  notes: string;
}

export interface Place {
  id: string;
  name: string;
  address: string;
  lat: number;
  lon: number;
  pinNote: string;
}

export interface Stop {
  id: string;
  locationId: string;
  dayId: string;
  plannedTime: string;
  status: StopStatus;
  notes: string;
  access: string;
}

export interface Trip {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  name: string;
  summary: string;
  timezone: string;
  status: TripStatus;
  days: Day[];
  locations: Place[];
  stops: Stop[];
  legModes: Record<string, LegMode>;
  createdAt: string;
  updatedAt: string;
  kind?: "waymark.trip";
  exportedAt?: string;
}

export interface Library {
  schemaVersion: typeof SCHEMA_VERSION;
  kind: "waymark.library";
  updatedAt: string;
  activeTripId: string | null;
  trips: Trip[];
  exportedAt?: string;
}

export interface Coord {
  lat: number;
  lon: number;
}

export interface LineStringGeometry {
  type: "LineString";
  coordinates: [number, number][];
}

export interface RoutePayload {
  provider: "fossgis-osrm" | "google-transit";
  profile: "driving" | "foot" | "bike" | "transit";
  mode: LegMode;
  distanceMeters: number;
  durationSeconds: number;
  geometry: LineStringGeometry;
  traffic: "not-live";
  fetchedAt: string;
  /** Services and the departure used for a public-transport leg. */
  summary?: string;
}

export type RouteView =
  | { status: "idle" }
  | { status: "same-place" }
  | { status: "loading" }
  | { status: "ready"; route: RoutePayload; fromCache: boolean }
  | { status: "error"; message: string; cancelled?: boolean };

export interface GeocodeHit {
  label: string;
  lat: number;
  lon: number;
}

export interface NearbyPlace {
  id: string;
  name: string;
  kind: string;
  lat: number;
  lon: number;
  straightLineMeters: number;
  osmUrl: string;
}

export type NearbyCategory = "food" | "cafe" | "pharmacy" | "shops" | "sights";
