import { z } from "zod";
import { SCHEMA_VERSION, type Library, type Trip } from "@/lib/types";

const timestamp = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/);

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const daySchema = z
  .object({
    id: z.string().min(1).max(80),
    date: dateString,
    title: z.string().min(1).max(120),
    notes: z.string().max(2000),
  })
  .strict();

export const placeSchema = z
  .object({
    id: z.string().min(1).max(80),
    name: z.string().min(1).max(160),
    address: z.string().max(300),
    lat: z.number().finite().gte(-90).lte(90),
    lon: z.number().finite().gte(-180).lte(180),
    pinNote: z.string().max(600),
  })
  .strict();

export const stopSchema = z
  .object({
    id: z.string().min(1).max(80),
    locationId: z.string().min(1).max(80),
    dayId: z.string().min(1).max(80),
    plannedTime: z.string().max(160),
    status: z.enum(["proposed", "confirmed", "optional", "buffer"]),
    notes: z.string().max(2000),
    access: z.string().max(600),
  })
  .strict();

export const tripSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    id: z.string().min(1).max(80),
    name: z.string().min(1).max(160),
    summary: z.string().max(2000),
    timezone: z.string().min(1).max(80),
    status: z.enum(["proposed", "draft", "confirmed"]),
    days: z.array(daySchema).min(1).max(60),
    locations: z.array(placeSchema).max(200),
    stops: z.array(stopSchema).max(200),
    legModes: z.record(z.string(), z.enum(["driving", "walking", "cycling", "transit"])),
    createdAt: timestamp,
    updatedAt: timestamp,
    kind: z.literal("waymark.trip").optional(),
    exportedAt: timestamp.optional(),
  })
  .strict();

export const librarySchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    kind: z.literal("waymark.library"),
    updatedAt: timestamp,
    activeTripId: z.string().min(1).max(80).nullable(),
    trips: z.array(tripSchema).max(50),
    exportedAt: timestamp.optional(),
  })
  .strict();

export function zodIssues(error: { issues: { path: PropertyKey[]; message: string }[] }): string[] {
  return error.issues.slice(0, 24).map((issue) => {
    const path = issue.path.length ? issue.path.map(String).join(".") : "document";
    return `${path}: ${issue.message}`;
  });
}

export function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function integrityIssues(trip: Trip, path = "trip"): string[] {
  const issues: string[] = [];
  if (!isValidTimeZone(trip.timezone)) {
    issues.push(`${path}.timezone: ${trip.timezone} is not a known time zone.`);
  }
  const dayIds = new Set<string>();
  for (const day of trip.days) {
    if (dayIds.has(day.id)) issues.push(`${path}.days: duplicate id ${day.id}.`);
    dayIds.add(day.id);
    if (!isRealDate(day.date)) issues.push(`${path}.days.${day.id}: ${day.date} is not a real date.`);
  }
  const placeIds = new Set<string>();
  for (const place of trip.locations) {
    if (placeIds.has(place.id)) issues.push(`${path}.locations: duplicate id ${place.id}.`);
    placeIds.add(place.id);
  }
  const stopIds = new Set<string>();
  for (const stop of trip.stops) {
    if (stopIds.has(stop.id)) issues.push(`${path}.stops: duplicate id ${stop.id}.`);
    stopIds.add(stop.id);
    if (!placeIds.has(stop.locationId)) {
      issues.push(`${path}.stops.${stop.id}: unknown place ${stop.locationId}.`);
    }
    if (!dayIds.has(stop.dayId)) {
      issues.push(`${path}.stops.${stop.id}: unknown day ${stop.dayId}.`);
    }
  }
  for (const key of Object.keys(trip.legModes)) {
    if (!/^[^>]{1,80}>[^>]{1,80}$/.test(key)) {
      issues.push(`${path}.legModes: invalid key ${key}.`);
      continue;
    }
    const [fromId, toId] = key.split(">");
    if (!stopIds.has(fromId) || !stopIds.has(toId)) {
      issues.push(`${path}.legModes: ${key} does not match two stops.`);
    }
  }
  return issues;
}

export function libraryIntegrity(library: Library): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  library.trips.forEach((trip, index) => {
    if (ids.has(trip.id)) issues.push(`trips: duplicate id ${trip.id}.`);
    ids.add(trip.id);
    issues.push(...integrityIssues(trip, `trips.${index}`));
  });
  if (library.activeTripId && !ids.has(library.activeTripId)) {
    issues.push("activeTripId does not match a trip. It was not rewritten.");
  }
  return issues;
}
