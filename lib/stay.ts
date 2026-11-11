import { nightCount } from "@/lib/format";
import { classifyPlace, type PlaceKind } from "@/lib/place-kind";
import type { Trip } from "@/lib/types";

export interface StayEstimate {
  /** Short label for a pin, such as "2 h" or "Overnight". */
  label: string;
  minutes: number | null;
  /** A clock window or an overnight date came from the trip. A kind default is an estimate. */
  source: "planned" | "estimated";
}

const KIND_MINUTES: Record<PlaceKind, number> = {
  airport: 180,
  hotel: 180,
  restaurant: 120,
  cafe: 75,
  temple: 120,
  shopping: 180,
  sight: 150,
  transit: 30,
  health: 60,
  park: 120,
  bar: 150,
  place: 120,
};

function formatMinutes(minutes: number): string {
  const rounded = Math.max(1, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  if (hours === 0) return `${rest} min`;
  if (rest === 0) return `${hours} h`;
  return `${hours} h ${rest} min`;
}

/** The longer end of a written range, or the span of two clock times. */
export function statedMinutes(text: string): number | null {
  const minutes = text.match(/(\d+)\s*[–—-]\s*(\d+)\s*(?:minutes|minute|mins|min)\b/i);
  if (minutes) return Math.max(Number(minutes[1]), Number(minutes[2]));
  const hours = text.match(/(\d+(?:\.\d+)?)\s*[–—-]\s*(\d+(?:\.\d+)?)\s*(?:hours|hour|hrs|hr)\b/i);
  if (hours) return Math.round(Math.max(Number(hours[1]), Number(hours[2])) * 60);
  if (/\bseveral hours\b/i.test(text)) return 180;
  const clocks = [...text.matchAll(/\b(\d{1,2}):(\d{2})\b/g)];
  if (clocks.length < 2) return null;
  const toMinutes = (match: RegExpMatchArray) => Number(match[1]) * 60 + Number(match[2]);
  const start = toMinutes(clocks[0]);
  const end = toMinutes(clocks[1]);
  if (start > 23 * 60 + 59 || end > 23 * 60 + 59) return null;
  let span = end - start;
  if (span <= 0) span += 24 * 60;
  if (span <= 0 || span > 18 * 60) return null;
  return span;
}

function dayDate(trip: Trip, dayId: string): string {
  return trip.days.find((day) => day.id === dayId)?.date ?? "";
}

/**
 * How long the current stop is expected to last.
 * A written range uses its longer end. Staying until a later day is overnight.
 * Otherwise the estimate follows the kind of place and is on the long side.
 */
export function stayEstimate(trip: Trip, index: number): StayEstimate | null {
  const stop = trip.stops[index];
  if (!stop) return null;
  const place = trip.locations.find((item) => item.id === stop.locationId);
  let leave = index + 1;
  while (leave < trip.stops.length && trip.stops[leave].locationId === stop.locationId) leave += 1;
  const next = trip.stops[leave];
  const nights = next ? nightCount(dayDate(trip, stop.dayId), dayDate(trip, next.dayId)) : null;
  if (nights != null && nights >= 1) {
    return {
      label: nights === 1 ? "Overnight" : `${nights} nights`,
      minutes: nights * 24 * 60,
      source: "planned",
    };
  }
  const stated = statedMinutes(`${stop.plannedTime}\n${stop.notes}`);
  if (stated != null) {
    return { label: formatMinutes(stated), minutes: stated, source: "planned" };
  }
  const kind = classifyPlace({
    name: place?.name ?? "",
    address: place?.address ?? "",
    pinNote: place?.pinNote ?? "",
    notes: `${stop.notes} ${stop.access}`,
  });
  const minutes = KIND_MINUTES[kind];
  return { label: formatMinutes(minutes), minutes, source: "estimated" };
}

export function stayPhrase(stay: StayEstimate): string {
  if (stay.label === "Overnight" || stay.label.endsWith("nights")) return stay.label;
  return stay.source === "estimated" ? `About ${stay.label} here` : `${stay.label} here`;
}
