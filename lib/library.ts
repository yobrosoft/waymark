import { createId, legKey } from "@/lib/ids";
import { bangkokTrip, sampleLibrary } from "@/lib/seed";
import {
  integrityIssues,
  isValidTimeZone,
  libraryIntegrity,
  librarySchema,
  tripSchema,
  zodIssues,
} from "@/lib/schema";
import type { KeyValueStore } from "@/lib/storage";
import { LIBRARY_KEY } from "@/lib/storage";
import type { LegMode, Library, Trip } from "@/lib/types";

export interface LoadedLibrary {
  ok: true;
  library: Library;
  warnings: string[];
}

export interface RejectedLibrary {
  ok: false;
  message: string;
  issues: string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function loadStoredLibrary(raw: unknown): LoadedLibrary | RejectedLibrary {
  const record = asRecord(raw);
  if (!record) {
    return {
      ok: false,
      message: "The saved trip book is not a document. It was left untouched.",
      issues: ["Saved value was not an object."],
    };
  }
  const version = record.schemaVersion;
  if (typeof version === "number" && version > 1) {
    return {
      ok: false,
      message: `This browser has a trip book from a newer Waymark (version ${version}). This app will not change it.`,
      issues: [`schemaVersion ${version} is newer than 1.`],
    };
  }
  if (version !== 1 && version !== undefined) {
    return {
      ok: false,
      message: "The saved trip book version was not recognized. It was left untouched.",
      issues: [`schemaVersion ${String(version)} is not supported.`],
    };
  }
  const candidate = {
    ...record,
    schemaVersion: 1,
    kind: record.kind ?? "waymark.library",
  };
  const parsed = librarySchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Saved trip data did not match version 1 and was not replaced.",
      issues: zodIssues(parsed.error),
    };
  }
  const dangling =
    parsed.data.activeTripId !== null &&
    !parsed.data.trips.some((trip) => trip.id === parsed.data.activeTripId);
  const library: Library = dangling
    ? { ...parsed.data, activeTripId: parsed.data.trips[0]?.id ?? null }
    : parsed.data;
  const issues = libraryIntegrity(library).filter(
    (issue) => !issue.startsWith("activeTripId"),
  );
  if (issues.length) {
    return {
      ok: false,
      message: "Saved trips have broken links. They were not replaced with the sample.",
      issues,
    };
  }
  const warnings: string[] = [];
  if (record.kind == null) {
    warnings.push("The saved file had no kind marker. It matched a Waymark library and was opened without changing trips.");
  }
  if (dangling) {
    warnings.push("The saved active trip was missing. Opened another trip without changing trip contents.");
  }
  return { ok: true, library, warnings };
}

export async function bootstrapLibrary(
  store: KeyValueStore,
  now: string,
): Promise<
  | { ok: true; library: Library; seeded: boolean; warnings: string[] }
  | { ok: false; message: string; issues: string[]; raw: unknown }
> {
  const raw = await store.get(LIBRARY_KEY);
  if (raw === undefined) {
    const library = sampleLibrary(now);
    await store.set(LIBRARY_KEY, library);
    return { ok: true, library, seeded: true, warnings: [] };
  }
  const loaded = loadStoredLibrary(raw);
  if (!loaded.ok) return { ...loaded, raw };
  return { ok: true, library: loaded.library, seeded: false, warnings: loaded.warnings };
}

export function reidentify(
  trip: Trip,
  now: string,
  newId: (prefix: string) => string = createId,
  name?: string,
): Trip {
  const dayIds = new Map(trip.days.map((day) => [day.id, newId("day")]));
  const placeIds = new Map(trip.locations.map((place) => [place.id, newId("loc")]));
  const stopIds = new Map(trip.stops.map((stop) => [stop.id, newId("stop")]));
  const legModes: Record<string, LegMode> = {};
  for (const [key, mode] of Object.entries(trip.legModes)) {
    const [fromId, toId] = key.split(">");
    const nextFrom = stopIds.get(fromId);
    const nextTo = stopIds.get(toId);
    if (nextFrom && nextTo) legModes[legKey(nextFrom, nextTo)] = mode;
  }
  return {
    ...trip,
    id: newId("trip"),
    name: (name ?? trip.name).slice(0, 160),
    days: trip.days.map((day) => ({ ...day, id: dayIds.get(day.id)! })),
    locations: trip.locations.map((place) => ({ ...place, id: placeIds.get(place.id)! })),
    stops: trip.stops.map((stop) => ({
      ...stop,
      id: stopIds.get(stop.id)!,
      dayId: dayIds.get(stop.dayId)!,
      locationId: placeIds.get(stop.locationId)!,
    })),
    legModes,
    kind: undefined,
    exportedAt: undefined,
    createdAt: now,
    updatedAt: now,
  };
}

export function duplicateTrip(trip: Trip, now: string, newId: (prefix: string) => string = createId): Trip {
  return reidentify(trip, now, newId, `Copy of ${trip.name}`.slice(0, 160));
}

export function blankTrip(
  now: string,
  newId: (prefix: string) => string = createId,
  input?: { name?: string; timezone?: string },
): Trip {
  const timezone = input?.timezone?.trim() || "Asia/Bangkok";
  return {
    schemaVersion: 1,
    id: newId("trip"),
    name: input?.name?.trim().slice(0, 160) || "New trip",
    summary: "Draft trip. Nothing here is confirmed.",
    timezone: isValidTimeZone(timezone) ? timezone : "Asia/Bangkok",
    status: "draft",
    days: [
      {
        id: newId("day"),
        date: now.slice(0, 10),
        title: "Day 1",
        notes: "",
      },
    ],
    locations: [],
    stops: [],
    legModes: {},
    createdAt: now,
    updatedAt: now,
  };
}

export function saveTrip(library: Library, trip: Trip, now: string): Library {
  const next = { ...trip, updatedAt: now, kind: undefined, exportedAt: undefined };
  const exists = library.trips.some((item) => item.id === trip.id);
  return {
    ...library,
    trips: exists
      ? library.trips.map((item) => (item.id === trip.id ? next : item))
      : [...library.trips, next],
    activeTripId: trip.id,
    updatedAt: now,
  };
}

export function deleteTrip(library: Library, tripId: string, now: string): Library {
  const trips = library.trips.filter((trip) => trip.id !== tripId);
  const activeTripId =
    library.activeTripId === tripId ? (trips[0]?.id ?? null) : library.activeTripId;
  return { ...library, trips, activeTripId, updatedAt: now };
}

export function addSampleTrip(library: Library, now: string, newId: (prefix: string) => string = createId): Library | { error: string } {
  if (library.trips.length >= 50) return { error: "This browser already has 50 trips. Delete or export one first." };
  const copy = reidentify(bangkokTrip(now), now, newId);
  return saveTrip(library, copy, now);
}

export type ImportCommit = "copy" | "replace";

export function parseImport(
  text: string,
): { ok: true; trips: Trip[]; warnings: string[] } | { ok: false; issues: string[] } {
  if (text.length > 2_000_000) {
    return { ok: false, issues: ["File is larger than 2 MB."] };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, issues: ["File is not valid JSON."] };
  }
  const warnings: string[] = [];
  const records: unknown[] = [];
  if (Array.isArray(json)) {
    records.push(...json);
    warnings.push("Imported a list of trips.");
  } else {
    const record = asRecord(json);
    if (!record) return { ok: false, issues: ["The file root must be a trip, a library, or a list of trips."] };
    if (record.kind === "waymark.library" || Array.isArray(record.trips)) {
      const version = record.schemaVersion;
      if (typeof version === "number" && version > 1) {
        return { ok: false, issues: [`This file uses schema version ${version}, which this app cannot import.`] };
      }
      const parsed = librarySchema.safeParse({
        ...record,
        schemaVersion: 1,
        kind: "waymark.library",
      });
      if (!parsed.success) return { ok: false, issues: zodIssues(parsed.error) };
      const issues = libraryIntegrity({
        ...parsed.data,
        activeTripId: parsed.data.trips.some((trip) => trip.id === parsed.data.activeTripId)
          ? parsed.data.activeTripId
          : null,
      });
      if (issues.length) return { ok: false, issues };
      if (record.kind !== "waymark.library") {
        warnings.push("File had no library kind. The trips matched Waymark and can be imported.");
      }
      return { ok: true, trips: parsed.data.trips, warnings };
    }
    records.push(record);
  }

  if (records.length === 0) return { ok: false, issues: ["The file has no trips."] };
  if (records.length > 50) return { ok: false, issues: ["A file can contain at most 50 trips."] };
  const trips: Trip[] = [];
  const issues: string[] = [];
  records.forEach((item, index) => {
    const record = asRecord(item);
    if (!record) {
      issues.push(`trips.${index}: not an object.`);
      return;
    }
    if (record.kind != null && record.kind !== "waymark.trip") {
      issues.push(`trips.${index}: kind ${String(record.kind)} is not a Waymark trip.`);
      return;
    }
    if (typeof record.schemaVersion === "number" && record.schemaVersion > 1) {
      issues.push(`trips.${index}: schema version ${record.schemaVersion} is newer than this app.`);
      return;
    }
    const parsed = tripSchema.safeParse({ ...record, schemaVersion: 1 });
    if (!parsed.success) {
      issues.push(...zodIssues(parsed.error).map((issue) => `trips.${index}.${issue}`));
      return;
    }
    issues.push(...integrityIssues(parsed.data, `trips.${index}`));
    trips.push(parsed.data);
  });
  if (issues.length) return { ok: false, issues };
  return { ok: true, trips, warnings };
}

export function applyImport(
  library: Library,
  trips: Trip[],
  mode: ImportCommit,
  now: string,
  newId: (prefix: string) => string = createId,
): { ok: true; library: Library; added: number; replaced: number } | { ok: false; message: string } {
  if (mode === "copy") {
    if (library.trips.length + trips.length > 50) {
      return { ok: false, message: "Importing these as new trips would pass the 50-trip limit. Nothing was changed." };
    }
    const copies = trips.map((trip) => reidentify(trip, now, newId));
    return {
      ok: true,
      added: copies.length,
      replaced: 0,
      library: {
        ...library,
        trips: [...library.trips, ...copies],
        updatedAt: now,
      },
    };
  }
  const incoming = new Map(trips.map((trip) => [trip.id, { ...trip, updatedAt: now }]));
  let replaced = 0;
  const nextTrips = library.trips.map((trip) => {
    const update = incoming.get(trip.id);
    if (!update) return trip;
    incoming.delete(trip.id);
    replaced += 1;
    return update;
  });
  const added = [...incoming.values()];
  if (nextTrips.length + added.length > 50) {
    return { ok: false, message: "This import would pass the 50-trip limit. Nothing was changed." };
  }
  return {
    ok: true,
    added: added.length,
    replaced,
    library: {
      ...library,
      trips: [...nextTrips, ...added],
      updatedAt: now,
    },
  };
}

export function libraryDocument(library: Library, now: string): Library {
  return { ...library, kind: "waymark.library", exportedAt: now };
}

export function tripDocument(trip: Trip, now: string): Trip {
  return { ...trip, kind: "waymark.trip", exportedAt: now };
}
