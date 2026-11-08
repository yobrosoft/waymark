import type { Trip } from "@/lib/types";

export function samePlan(a: Trip, b: Trip): boolean {
  const rest = (trip: Trip) =>
    JSON.stringify({
      schemaVersion: trip.schemaVersion,
      id: trip.id,
      name: trip.name,
      summary: trip.summary,
      timezone: trip.timezone,
      status: trip.status,
      days: trip.days,
      locations: trip.locations,
      stops: trip.stops,
      legModes: trip.legModes,
      createdAt: trip.createdAt,
    });
  return rest(a) === rest(b);
}

export interface PlanChange {
  id: string;
  text: string;
}

function placeName(trip: Trip, locationId: string): string {
  return trip.locations.find((place) => place.id === locationId)?.name ?? "Untitled place";
}

function dayLabel(trip: Trip, dayId: string): string {
  const day = trip.days.find((item) => item.id === dayId);
  return day ? `${day.date} ${day.title}` : "another day";
}

export function diffTrips(before: Trip, after: Trip): PlanChange[] {
  const changes: PlanChange[] = [];
  const push = (id: string, text: string) => changes.push({ id, text });

  if (before.name !== after.name) push("name", `Renamed the trip to “${after.name}”.`);
  if (before.summary !== after.summary) push("summary", "Updated the trip summary.");
  if (before.status !== after.status) push("status", `Marked the trip ${after.status}.`);
  if (before.timezone !== after.timezone) push("timezone", `Changed the time zone to ${after.timezone}.`);

  const beforeDays = new Map(before.days.map((day) => [day.id, day]));
  const afterDays = new Map(after.days.map((day) => [day.id, day]));
  for (const day of after.days) {
    const previous = beforeDays.get(day.id);
    if (!previous) {
      push(`day-add-${day.id}`, `Added ${day.date}, ${day.title}.`);
      continue;
    }
    if (previous.date !== day.date || previous.title !== day.title) {
      push(`day-${day.id}`, `Updated ${previous.date} to ${day.date}, ${day.title}.`);
    } else if (previous.notes !== day.notes) {
      push(`day-notes-${day.id}`, `Updated the notes for ${day.date}.`);
    }
  }
  for (const day of before.days) {
    if (!afterDays.has(day.id)) push(`day-remove-${day.id}`, `Removed ${day.date}, ${day.title}.`);
  }

  const beforePlaces = new Map(before.locations.map((place) => [place.id, place]));
  const afterPlaces = new Map(after.locations.map((place) => [place.id, place]));
  for (const place of after.locations) {
    const previous = beforePlaces.get(place.id);
    if (!previous) {
      push(`place-add-${place.id}`, `Added the place ${place.name}.`);
      continue;
    }
    if (previous.name !== place.name) push(`place-name-${place.id}`, `Renamed ${previous.name} to ${place.name}.`);
    if (previous.address !== place.address) push(`place-address-${place.id}`, `Updated the address for ${place.name}.`);
    if (Math.abs(previous.lat - place.lat) > 0.00001 || Math.abs(previous.lon - place.lon) > 0.00001) {
      push(`place-pin-${place.id}`, `Moved the pin for ${place.name}.`);
    }
    if (previous.pinNote !== place.pinNote) push(`place-note-${place.id}`, `Updated the pin note for ${place.name}.`);
  }
  for (const place of before.locations) {
    if (!afterPlaces.has(place.id)) push(`place-remove-${place.id}`, `Removed the place ${place.name}.`);
  }

  const beforeStops = new Map(before.stops.map((stop) => [stop.id, stop]));
  const afterStops = new Map(after.stops.map((stop) => [stop.id, stop]));
  for (const stop of after.stops) {
    const previous = beforeStops.get(stop.id);
    const name = placeName(after, stop.locationId);
    if (!previous) {
      push(`stop-add-${stop.id}`, `Added ${name} on ${dayLabel(after, stop.dayId)}.`);
      continue;
    }
    if (previous.locationId !== stop.locationId) {
      push(`stop-place-${stop.id}`, `Pointed a visit at ${placeName(after, stop.locationId)} instead of ${placeName(before, previous.locationId)}.`);
    }
    if (previous.dayId !== stop.dayId) {
      push(`stop-day-${stop.id}`, `Moved ${name} to ${dayLabel(after, stop.dayId)}.`);
    }
    if (previous.plannedTime !== stop.plannedTime) {
      push(`stop-time-${stop.id}`, stop.plannedTime ? `Set ${name} to ${stop.plannedTime}.` : `Cleared the planned time for ${name}.`);
    }
    if (previous.status !== stop.status) push(`stop-status-${stop.id}`, `Marked ${name} as ${stop.status}.`);
    if (previous.notes !== stop.notes) push(`stop-notes-${stop.id}`, `Updated the notes for ${name}.`);
    if (previous.access !== stop.access) push(`stop-access-${stop.id}`, `Updated the access note for ${name}.`);
  }
  for (const stop of before.stops) {
    if (!afterStops.has(stop.id)) {
      push(`stop-remove-${stop.id}`, `Removed ${placeName(before, stop.locationId)}.`);
    }
  }

  const sharedBefore = before.stops.filter((stop) => afterStops.has(stop.id)).map((stop) => stop.id);
  const sharedAfter = after.stops.filter((stop) => beforeStops.has(stop.id)).map((stop) => stop.id);
  if (sharedBefore.join(">") !== sharedAfter.join(">")) {
    const moved = sharedBefore.filter((id, index) => sharedAfter.indexOf(id) !== index);
    if (moved.length > 3) {
      push("order", "Reordered the stops.");
    } else {
      for (const id of moved) {
        const stop = afterStops.get(id)!;
        push(
          `order-${id}`,
          `Moved ${placeName(after, stop.locationId)} from position ${before.stops.findIndex((item) => item.id === id) + 1} to ${after.stops.findIndex((item) => item.id === id) + 1}.`,
        );
      }
    }
  }

  const modeKeys = new Set([...Object.keys(before.legModes), ...Object.keys(after.legModes)]);
  for (const key of modeKeys) {
    if (before.legModes[key] === after.legModes[key]) continue;
    const [fromId, toId] = key.split(">");
    const from = afterStops.get(fromId) ?? beforeStops.get(fromId);
    const to = afterStops.get(toId) ?? beforeStops.get(toId);
    const fromName = from ? placeName(afterStops.has(from.id) ? after : before, from.locationId) : "a stop";
    const toName = to ? placeName(afterStops.has(to.id) ? after : before, to.locationId) : "a stop";
    const mode = after.legModes[key];
    push(
      `mode-${key}`,
      mode ? `Set ${fromName} → ${toName} to ${mode}.` : `Cleared the mode for ${fromName} → ${toName}.`,
    );
  }

  return changes;
}
