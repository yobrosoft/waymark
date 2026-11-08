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
