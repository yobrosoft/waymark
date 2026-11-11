import { legKey } from "@/lib/ids";
import { isSamePlace } from "@/lib/geo";
import { classifyPlace, placeKindLabel, type PlaceKind } from "@/lib/place-kind";
import { stayEstimate } from "@/lib/stay";
import type { LegMode, Library, Place, Stop, Trip } from "@/lib/types";

export const DAY_COLORS = [
  "#007aff",
  "#34c759",
  "#ff9500",
  "#af52de",
  "#ff2d55",
  "#5ac8fa",
  "#5856d6",
];

export function clampIndex(length: number, index: number): number {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(length - 1, Math.trunc(index)));
}

export function stepIndex(length: number, index: number, delta: number): number {
  return clampIndex(length, clampIndex(length, index) + delta);
}

export function placesById(trip: Trip): Map<string, Place> {
  return new Map(trip.locations.map((place) => [place.id, place]));
}

export interface SelectedLeg {
  fromStop: Stop;
  toStop: Stop;
  from: Place;
  to: Place;
  samePlace: boolean;
  mode: LegMode;
}

export function selectedLeg(trip: Trip, index: number): SelectedLeg | null {
  if (index <= 0 || index >= trip.stops.length) return null;
  const fromStop = trip.stops[index - 1];
  const toStop = trip.stops[index];
  const places = placesById(trip);
  const from = places.get(fromStop.locationId);
  const to = places.get(toStop.locationId);
  if (!from || !to) return null;
  const samePlace = isSamePlace(from, to);
  const mode = trip.legModes[legKey(fromStop.id, toStop.id)] ?? "driving";
  return { fromStop, toStop, from, to, samePlace, mode };
}

export function firstStopIndexForDay(trip: Trip, dayId: string): number {
  return trip.stops.findIndex((stop) => stop.dayId === dayId);
}

/**
 * Clicking a pin moves to that place's next visit.
 * If the current stop is already there, advance to a later visit, then wrap.
 * If it is somewhere else, choose the next visit at or after the current stop, then wrap.
 */
export function selectPinIndex(trip: Trip, currentIndex: number, locationId: string): number {
  const indexes = trip.stops.flatMap((stop, index) =>
    stop.locationId === locationId ? [index] : [],
  );
  if (indexes.length === 0) return clampIndex(trip.stops.length, currentIndex);
  const current = clampIndex(trip.stops.length, currentIndex);
  const here = trip.stops[current]?.locationId === locationId;
  if (here) {
    return indexes.find((index) => index > current) ?? indexes[0];
  }
  return indexes.find((index) => index >= current) ?? indexes[0];
}

export function moveStop(trip: Trip, index: number, direction: -1 | 1, now: string): Trip {
  const nextIndex = index + direction;
  if (index < 0 || index >= trip.stops.length || nextIndex < 0 || nextIndex >= trip.stops.length) {
    return trip;
  }
  const stops = trip.stops.slice();
  const [item] = stops.splice(index, 1);
  stops.splice(nextIndex, 0, item);
  return { ...trip, stops, updatedAt: now };
}

export function sequenceWarnings(trip: Trip): string[] {
  const dates = new Map(trip.days.map((day) => [day.id, day.date]));
  const warnings: string[] = [];
  for (let index = 1; index < trip.stops.length; index += 1) {
    const previous = dates.get(trip.stops[index - 1].dayId);
    const current = dates.get(trip.stops[index].dayId);
    if (previous && current && current < previous) {
      warnings.push(
        `Stop ${index + 1} is dated ${current}, which is before stop ${index} (${previous}).`,
      );
    }
  }
  return warnings;
}

export interface MapPlace {
  locationId: string;
  name: string;
  lat: number;
  lon: number;
  visits: number[];
  color: string;
  selected: boolean;
  badge: string;
  kind: PlaceKind;
  kindLabel: string;
  aria: string;
  /** The stop you are going to on this leg. Larger than the place you are leaving. */
  emphasis: "next" | "from" | "other";
  /** Time expected at the next place. Empty on the other pins. */
  stay: string;
}

export function mapPlaces(trip: Trip, index: number): MapPlace[] {
  const dayIndex = new Map(trip.days.map((day, position) => [day.id, position]));
  const places = placesById(trip);
  const grouped = new Map<string, number[]>();
  trip.stops.forEach((stop, stopIndex) => {
    const list = grouped.get(stop.locationId) ?? [];
    list.push(stopIndex);
    grouped.set(stop.locationId, list);
  });
  const nextId = trip.stops[index]?.locationId;
  const fromId = index > 0 ? trip.stops[index - 1]?.locationId : undefined;
  const stay = stayEstimate(trip, index)?.label ?? "";
  const markers: MapPlace[] = [];
  for (const [locationId, visits] of grouped) {
    const place = places.get(locationId);
    if (!place) continue;
    const selected = visits.includes(index);
    const shown = selected ? index : visits[0];
    const color = DAY_COLORS[(dayIndex.get(trip.stops[shown].dayId) ?? 0) % DAY_COLORS.length];
    const notes = visits.map((visit) => `${trip.stops[visit].notes} ${trip.stops[visit].access}`).join(" ");
    const kind = classifyPlace({
      name: place.name,
      address: place.address,
      pinNote: place.pinNote,
      notes,
    });
    const kindLabel = placeKindLabel(kind);
    const emphasis = locationId === nextId ? "next" : locationId === fromId ? "from" : "other";
    markers.push({
      locationId,
      name: place.name,
      lat: place.lat,
      lon: place.lon,
      visits,
      color,
      selected,
      badge: String(shown + 1),
      kind,
      kindLabel,
      emphasis,
      stay: emphasis === "next" ? stay : "",
      aria: `${place.name}, ${kindLabel}. Stop ${shown + 1}${
        visits.length > 1 ? `, ${visits.length} visits on this trip` : ""
      }${emphasis === "next" && stay ? `. ${stay}` : ""}`,
    });
  }
  return markers;
}

export function activeTrip(library: Library): Trip | null {
  return (
    library.trips.find((trip) => trip.id === library.activeTripId) ??
    library.trips[0] ??
    null
  );
}

export function locationUseCount(trip: Trip, locationId: string): number {
  return trip.stops.filter((stop) => stop.locationId === locationId).length;
}

export interface StopDraft {
  stopId: string | null;
  dayId: string;
  plannedTime: string;
  status: Stop["status"];
  notes: string;
  access: string;
  /** Use this place unchanged. Place fields are ignored. */
  reuseLocationId: string | null;
  /** Copy the pin so other stops keep the previous place. */
  detach: boolean;
  name: string;
  address: string;
  lat: string;
  lon: string;
  pinNote: string;
}

function clean(value: string, max: number): string {
  return value.trim().slice(0, max);
}

export function applyStopDraft(
  trip: Trip,
  draft: StopDraft,
  insertAt: number | null,
  now: string,
  newId: (prefix: string) => string,
): { ok: true; trip: Trip; index: number } | { ok: false; issues: string[] } {
  const issues: string[] = [];
  if (!trip.days.some((day) => day.id === draft.dayId)) issues.push("Choose a day on this trip.");
  if (!["proposed", "confirmed", "optional", "buffer"].includes(draft.status)) {
    issues.push("Stop status is not valid.");
  }
  const locations = trip.locations.map((place) => ({ ...place }));
  const editing = draft.stopId ? trip.stops.find((stop) => stop.id === draft.stopId) : undefined;
  let locationId = draft.reuseLocationId;
  if (locationId) {
    if (!locations.some((place) => place.id === locationId)) {
      issues.push("That saved place is not on this trip.");
    }
  } else {
    const name = clean(draft.name, 160);
    const lat = Number(draft.lat);
    const lon = Number(draft.lon);
    if (!name) issues.push("A place needs a name.");
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) issues.push("Latitude must be a number from -90 to 90.");
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
      issues.push("Longitude must be a number from -180 to 180.");
    }
    if (!issues.length) {
      const placeFields = {
        name,
        address: clean(draft.address, 300),
        lat,
        lon,
        pinNote: clean(draft.pinNote, 600),
      };
      const current = editing ? locations.find((place) => place.id === editing.locationId) : undefined;
      if (editing && current && !draft.detach) {
        Object.assign(current, placeFields);
        locationId = current.id;
      } else {
        locationId = newId("loc");
        locations.push({ id: locationId, ...placeFields });
      }
    }
  }
  if (issues.length || !locationId) return { ok: false, issues };

  const stopFields: Stop = {
    id: editing?.id ?? newId("stop"),
    locationId,
    dayId: draft.dayId,
    plannedTime: clean(draft.plannedTime, 160),
    status: draft.status,
    notes: clean(draft.notes, 2000),
    access: clean(draft.access, 600),
  };

  let stops: Stop[];
  let index: number;
  if (editing) {
    stops = trip.stops.map((stop) => (stop.id === editing.id ? stopFields : stop));
    index = stops.findIndex((stop) => stop.id === editing.id);
  } else {
    const at = insertAt == null ? trip.stops.length : Math.max(0, Math.min(trip.stops.length, insertAt));
    stops = trip.stops.slice();
    stops.splice(at, 0, stopFields);
    index = at;
  }

  return {
    ok: true,
    index,
    trip: { ...trip, locations, stops, updatedAt: now },
  };
}

export function deleteStop(trip: Trip, stopId: string, now: string): Trip {
  return {
    ...trip,
    stops: trip.stops.filter((stop) => stop.id !== stopId),
    updatedAt: now,
  };
}

export function setLegMode(trip: Trip, index: number, mode: LegMode, now: string): Trip {
  const leg = selectedLeg(trip, index);
  if (!leg || leg.samePlace || leg.mode === mode) return trip;
  return {
    ...trip,
    legModes: { ...trip.legModes, [legKey(leg.fromStop.id, leg.toStop.id)]: mode },
    updatedAt: now,
  };
}
