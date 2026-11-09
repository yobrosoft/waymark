export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return "Distance unavailable";
  if (meters < 950) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  return `${km >= 10 ? km.toFixed(0) : km.toFixed(1)} km`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "Time unavailable";
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return "Under 1 min";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  if (rest === 0) return `${hours} h`;
  return `${hours} h ${rest} min`;
}

/** A short label for the timeline. A clock in the note wins; otherwise a time of day. */
export function approximateTime(plannedTime: string): string {
  const text = plannedTime.trim();
  if (!text) return "—";
  const clock = text.match(/\b(\d{1,2}):(\d{2})\b/);
  if (clock) {
    const hour = Number(clock[1]);
    const minute = clock[2];
    if (hour >= 0 && hour <= 23) return `${hour}:${minute}`;
  }
  const lower = text.toLowerCase();
  const labels: [string, string][] = [
    ["late evening", "Late"],
    ["after dinner", "Night"],
    ["evening", "Evening"],
    ["afternoon", "Afternoon"],
    ["midday", "Midday"],
    ["morning", "Morning"],
    ["lunch", "Lunch"],
    ["dinner", "Dinner"],
    ["night", "Night"],
  ];
  for (const [needle, label] of labels) {
    if (lower.includes(needle)) return label;
  }
  return "—";
}

/** Calendar nights from one date to a later date. Null when the dates are not a forward pair. */
export function nightCount(earlier: string, later: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(earlier) || !/^\d{4}-\d{2}-\d{2}$/.test(later)) return null;
  const start = Date.parse(`${earlier}T00:00:00Z`);
  const end = Date.parse(`${later}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  const days = Math.round((end - start) / 86_400_000);
  return days > 0 ? days : null;
}

export function nightLabel(count: number | null): string {
  if (count == null || count <= 1) return "Night";
  return `${count} nights`;
}

export function formatDay(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const value = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(value.getTime())) return date;
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(value);
}

export function formatWhen(iso: string): string {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

export const STOP_STATUS_LABEL: Record<string, string> = {
  proposed: "Proposed",
  confirmed: "Confirmed",
  optional: "Optional",
  buffer: "Same-place rest",
};

export const TRIP_STATUS_LABEL: Record<string, string> = {
  proposed: "Proposed",
  draft: "Draft",
  confirmed: "Confirmed",
};

export const MODE_LABEL: Record<string, string> = {
  driving: "Drive",
  walking: "Walk",
  cycling: "Cycle",
};
