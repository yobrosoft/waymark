import type { Library, Trip } from "@/lib/types";

export const API_URL = (process.env.NEXT_PUBLIC_WAYMARK_API_URL ?? "").replace(/\/$/, "");
const TOKEN_KEY = "waymark-account-token";

export function accountToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAccountToken(token: string | null) {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* The caller still holds the token for this page load. */
  }
}

export function shareTokenFromLocation(): string | null {
  if (typeof window === "undefined") return null;
  const token = new URLSearchParams(window.location.search).get("share");
  return token && token.trim() ? token.trim() : null;
}

async function request(path: string, init: RequestInit = {}, token = accountToken()): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${API_URL}${path}`, { ...init, headers });
}

async function read(response: Response): Promise<{ ok?: boolean; error?: string; trip?: Trip; trips?: { id: string }[]; token?: string }> {
  const body = (await response.json()) as { ok?: boolean; error?: string; trip?: Trip; trips?: { id: string }[]; token?: string };
  if (!response.ok || body.ok === false) {
    throw new Error(body.error || "The account service did not accept that.");
  }
  return body;
}

export async function signInWithGoogle(credential: string): Promise<string> {
  const response = await request("/v1/sessions", { method: "POST", body: JSON.stringify({ credential }) }, null);
  const body = await read(response);
  if (!body.token) throw new Error("Google sign-in did not open an account.");
  return body.token;
}

export async function createAccount(name: string): Promise<string> {
  const response = await request("/v1/accounts", { method: "POST", body: JSON.stringify({ name }) }, null);
  const body = await read(response);
  if (!body.token) throw new Error("The account was created without a token.");
  return body.token;
}

export async function loadAccountLibrary(activeTripId: string | null): Promise<Library> {
  const list = await request("/v1/trips");
  const listed = await read(list);
  const ids = (listed.trips ?? []).map((item) => item.id);
  const trips = await Promise.all(
    ids.map(async (id) => {
      const response = await request(`/v1/trips/${encodeURIComponent(id)}`);
      const body = await read(response);
      if (!body.trip) throw new Error("A trip in this account could not be read.");
      return body.trip;
    }),
  );
  const active = activeTripId && trips.some((trip) => trip.id === activeTripId) ? activeTripId : (trips[0]?.id ?? null);
  return {
    schemaVersion: 1,
    kind: "waymark.library",
    updatedAt: new Date().toISOString(),
    activeTripId: active,
    trips,
  };
}

export async function loadSharedTrip(token: string): Promise<Trip> {
  const response = await request(`/v1/shared/${encodeURIComponent(token)}`, {}, null);
  const body = await read(response);
  if (!body.trip) throw new Error("This share link does not match a trip.");
  return body.trip;
}

export async function createShareLink(tripId: string): Promise<string> {
  const response = await request(`/v1/trips/${encodeURIComponent(tripId)}/shares`, { method: "POST" });
  const body = (await response.json()) as { ok?: boolean; error?: string; token?: string };
  if (!response.ok || !body.token) throw new Error(body.error || "The share link was not created.");
  return body.token;
}

function fingerprint(trip: Trip): string {
  const copy: Partial<Trip> = { ...trip };
  delete copy.updatedAt;
  delete copy.exportedAt;
  return JSON.stringify(copy);
}

export async function syncAccountLibrary(prev: Library | null, next: Library) {
  const before = new Map((prev?.trips ?? []).map((trip) => [trip.id, fingerprint(trip)]));
  const kept = new Set(next.trips.map((trip) => trip.id));
  for (const trip of next.trips) {
    const prior = before.get(trip.id);
    if (prior == null) {
      const response = await request("/v1/trips", { method: "POST", body: JSON.stringify({ trip }) });
      await read(response);
    } else if (prior !== fingerprint(trip)) {
      const response = await request(`/v1/trips/${encodeURIComponent(trip.id)}`, {
        method: "PUT",
        body: JSON.stringify({ trip }),
      });
      await read(response);
    }
  }
  for (const id of before.keys()) {
    if (kept.has(id)) continue;
    const response = await request(`/v1/trips/${encodeURIComponent(id)}`, { method: "DELETE" });
    await read(response);
  }
}

export async function fetchAccountTrip(id: string): Promise<Trip | null> {
  const response = await request(`/v1/trips/${encodeURIComponent(id)}`);
  if (response.status === 404) return null;
  const body = await read(response);
  return body.trip ?? null;
}
