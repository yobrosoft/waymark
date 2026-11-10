import type { RoutePayload } from "@/lib/types";

const PAST_MS = 7 * 24 * 60 * 60 * 1000;
const FUTURE_MS = 100 * 24 * 60 * 60 * 1000;

export type TransitWhen =
  | { ok: true; at: Date; note: string; cacheKey: string }
  | { ok: false; message: string };

export interface TransitStepInput {
  travelMode: string;
  line?: string;
}

export interface TransitRouteInput {
  distanceMeters: number;
  durationMillis: number;
  path: { lat: number; lng: number }[];
  steps: TransitStepInput[];
  warnings?: string[];
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function zoneOffset(instant: Date, timeZone: string): number | null {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(instant);
  } catch {
    return null;
  }
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const year = Number(read("year"));
  const month = Number(read("month"));
  const day = Number(read("day"));
  let shownHour = Number(read("hour"));
  if (shownHour === 24) shownHour = 0;
  const shown = Date.UTC(year, month - 1, day, shownHour, Number(read("minute")), Number(read("second")));
  if (!Number.isFinite(shown)) return null;
  return shown - instant.getTime();
}

/** UTC instant whose wall clock in timeZone is date + hour:minute. */
export function zonedDateTime(date: string, hour: number, minute: number, timeZone: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const guess = new Date(`${date}T${pad(hour)}:${pad(minute)}:00Z`);
  if (Number.isNaN(guess.getTime())) return null;
  const first = zoneOffset(guess, timeZone);
  if (first == null) return null;
  const once = new Date(guess.getTime() - first);
  const second = zoneOffset(once, timeZone);
  if (second == null) return null;
  const utc = new Date(guess.getTime() - second);
  return Number.isNaN(utc.getTime()) ? null : utc;
}

function clock(plannedTime: string): { hour: number; minute: number } | null {
  const match = plannedTime.match(/\b(\d{1,2}):(\d{2})\b/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

function bucket(date: Date): string {
  const copy = new Date(date);
  copy.setUTCMinutes(Math.floor(copy.getUTCMinutes() / 15) * 15, 0, 0);
  return copy.toISOString().slice(0, 16);
}

function inWindow(at: Date, now: Date): boolean {
  const delta = at.getTime() - now.getTime();
  return delta >= -PAST_MS && delta <= FUTURE_MS;
}

function formatLeaving(at: Date, timeZone: string): string {
  try {
    const label = new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone,
    }).format(at);
    return `Leaving ${label}`;
  } catch {
    return `Leaving ${at.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  }
}

/**
 * Google transit covers about 7 days back and 100 days ahead.
 * A clock time on the stop's day is used when it falls in that window.
 * With no clock, 12:00 on that day is used and the note says so.
 */
export function transitDeparture(input: {
  date: string;
  plannedTime: string;
  timeZone: string;
  now?: Date;
}): TransitWhen {
  const now = input.now ?? new Date();
  const leavingNow = (): TransitWhen => ({
    ok: true,
    at: now,
    note: "No usable time on this stop, so this is public transport for leaving now.",
    cacheKey: bucket(now),
  });
  const timed = clock(input.plannedTime);
  const atClock = timed ? zonedDateTime(input.date, timed.hour, timed.minute, input.timeZone) : null;
  const atNoon = zonedDateTime(input.date, 12, 0, input.timeZone);

  if (atClock) {
    if (atClock.getTime() - now.getTime() > FUTURE_MS) {
      return {
        ok: false,
        message: "Google transit only covers the next 100 days. This stop is later than that, so no line was drawn.",
      };
    }
    if (inWindow(atClock, now)) {
      return { ok: true, at: atClock, note: `${formatLeaving(atClock, input.timeZone)}.`, cacheKey: atClock.toISOString().slice(0, 16) };
    }
    return {
      ok: true,
      at: now,
      note: "This stop's time is outside Google's transit window, so this is public transport for leaving now.",
      cacheKey: bucket(now),
    };
  }

  if (atNoon && atNoon.getTime() - now.getTime() > FUTURE_MS) {
    return {
      ok: false,
      message: "Google transit only covers the next 100 days. This stop is later than that, so no line was drawn.",
    };
  }
  if (atNoon && inWindow(atNoon, now)) {
    return {
      ok: true,
      at: atNoon,
      note: `No clock time on this stop, so this uses 12:00 that day. ${formatLeaving(atNoon, input.timeZone)}.`,
      cacheKey: atNoon.toISOString().slice(0, 16),
    };
  }
  return leavingNow();
}

function stepLabel(step: TransitStepInput): string | null {
  const mode = step.travelMode.toUpperCase();
  if (mode === "TRANSIT") {
    const line = step.line?.trim();
    return line || "Transit";
  }
  if (mode === "WALKING" || mode === "WALK") return "Walk";
  return null;
}

export function transitServices(steps: TransitStepInput[]): string {
  const labels: string[] = [];
  for (const step of steps) {
    const label = stepLabel(step);
    if (!label || labels[labels.length - 1] === label) continue;
    labels.push(label);
  }
  return labels.join(" · ");
}

export function parseTransitRoute(
  input: TransitRouteInput,
  fetchedAt: string,
  note: string,
): { ok: true; route: RoutePayload } | { ok: false; error: string } {
  if (
    !Number.isFinite(input.distanceMeters) ||
    !Number.isFinite(input.durationMillis) ||
    input.distanceMeters < 0 ||
    input.durationMillis < 0
  ) {
    return { ok: false, error: "Google omitted the transit distance or time. Those values were not guessed." };
  }
  if (input.path.length < 2 || input.path.length > 20000) {
    return { ok: false, error: "Google did not return a usable transit line. A straight line was not substituted." };
  }
  const coordinates: [number, number][] = [];
  for (const point of input.path) {
    if (
      !Number.isFinite(point.lat) ||
      !Number.isFinite(point.lng) ||
      point.lat < -90 ||
      point.lat > 90 ||
      point.lng < -180 ||
      point.lng > 180
    ) {
      return { ok: false, error: "Google returned a transit coordinate this app could not trust. No line was drawn." };
    }
    coordinates.push([point.lng, point.lat]);
  }
  const services = transitServices(input.steps);
  const warning = input.warnings?.find((item) => item.trim())?.trim();
  const summary = [services, note, warning].filter(Boolean).join(". ").slice(0, 400);
  return {
    ok: true,
    route: {
      provider: "google-transit",
      profile: "transit",
      mode: "transit",
      distanceMeters: input.distanceMeters,
      durationSeconds: Math.round(input.durationMillis / 1000),
      geometry: { type: "LineString", coordinates },
      traffic: "not-live",
      fetchedAt,
      summary,
    },
  };
}
