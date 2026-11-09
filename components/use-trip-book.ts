"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  addSampleTrip,
  applyImport,
  blankTrip,
  bootstrapLibrary,
  deleteTrip,
  duplicateTrip,
  saveTrip,
  tripDocument,
  type ImportCommit,
} from "@/lib/library";
import { integrityIssues, isValidTimeZone } from "@/lib/schema";
import { sampleLibrary } from "@/lib/seed";
import {
  cacheGet,
  cacheSet,
  GEOCODE_CACHE_KEY,
  idbStore,
  LIBRARY_KEY,
  memoryStore,
  NEARBY_CACHE_KEY,
  ROUTE_CACHE_KEY,
  type KeyValueStore,
} from "@/lib/storage";
import {
  API_URL,
  accountToken,
  fetchAccountTrip,
  loadAccountLibrary,
  loadSharedTrip,
  setAccountToken,
  shareTokenFromLocation,
  syncAccountLibrary,
} from "@/lib/account";
import { clampIndex, setLegMode } from "@/lib/trip-logic";
import type { GeocodeHit, LegMode, Library, NearbyPlace, RoutePayload, Trip } from "@/lib/types";

const UI_KEY = "waymark-ui-v1";
const ACTIVE_KEY = "waymark-active-trip";
const ROUTE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LOOKUP_TTL_MS = 12 * 60 * 60 * 1000;

export interface BlockInfo {
  message: string;
  issues: string[];
  raw: unknown;
}

function readIndex(tripId: string): number {
  try {
    const raw = JSON.parse(localStorage.getItem(UI_KEY) || "{}") as {
      indexByTrip?: Record<string, unknown>;
    };
    const value = raw.indexByTrip?.[tripId];
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function writeIndex(tripId: string, index: number) {
  try {
    const raw = JSON.parse(localStorage.getItem(UI_KEY) || "{}") as {
      indexByTrip?: Record<string, number>;
    };
    const indexByTrip = raw.indexByTrip && typeof raw.indexByTrip === "object" ? raw.indexByTrip : {};
    indexByTrip[tripId] = index;
    localStorage.setItem(UI_KEY, JSON.stringify({ indexByTrip }));
  } catch {
    /* The trip book itself is stored separately. A UI preference failure is not data loss. */
  }
}

function readActive(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

function writeActive(tripId: string | null) {
  try {
    if (tripId) window.localStorage.setItem(ACTIVE_KEY, tripId);
    else window.localStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* Choosing a trip still works for this page load. */
  }
}

export function useTripBook() {
  const [status, setStatus] = useState<"loading" | "ready" | "blocked" | "signed-out">("loading");
  const [library, setLibrary] = useState<Library | null>(null);
  const [block, setBlock] = useState<BlockInfo | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [index, setIndexState] = useState(0);
  const [readonly, setReadonly] = useState(false);
  const storeRef = useRef<KeyValueStore | null>(null);
  const libraryRef = useRef<Library | null>(null);
  const savingRef = useRef(false);
  const accountMode = Boolean(API_URL);

  async function openAccount(token: string) {
    setAccountToken(token);
    setReadonly(false);
    setStatus("loading");
    try {
      const next = await loadAccountLibrary(readActive());
      libraryRef.current = next;
      setLibrary(next);
      const chosen = next.trips.find((item) => item.id === next.activeTripId) ?? next.trips[0];
      setIndexState(chosen ? clampIndex(chosen.stops.length, readIndex(chosen.id)) : 0);
      setStatus("ready");
    } catch (err) {
      setAccountToken(null);
      setWarning(err instanceof Error ? err.message : "The account could not be opened.");
      setStatus("signed-out");
    }
  }

  useEffect(() => {
    if (!accountMode) return;
    let cancel = false;
    (async () => {
      const share = shareTokenFromLocation();
      if (share) {
        try {
          const shared = await loadSharedTrip(share);
          if (cancel) return;
          const next: Library = {
            schemaVersion: 1,
            kind: "waymark.library",
            updatedAt: new Date().toISOString(),
            activeTripId: shared.id,
            trips: [shared],
          };
          libraryRef.current = next;
          setLibrary(next);
          setReadonly(true);
          setIndexState(clampIndex(shared.stops.length, readIndex(shared.id)));
          setStatus("ready");
        } catch (err) {
          if (cancel) return;
          setWarning(err instanceof Error ? err.message : "This share link does not match a trip.");
          setStatus(accountToken() ? "loading" : "signed-out");
          if (accountToken()) void openAccount(accountToken()!);
        }
        return;
      }
      const token = accountToken();
      if (!token) {
        if (!cancel) setStatus("signed-out");
        return;
      }
      await openAccount(token);
    })();
    return () => {
      cancel = true;
    };
  }, [accountMode]);

  useEffect(() => {
    if (accountMode) return;
    let cancel = false;
    (async () => {
      let store: KeyValueStore = idbStore;
      try {
        await store.get(LIBRARY_KEY);
      } catch {
        store = memoryStore();
        if (!cancel) {
          setWarning(
            "This browser refused to store data. The trip lives in this tab only. Export a backup before you close it.",
          );
        }
      }
      storeRef.current = store;
      const result = await bootstrapLibrary(store, new Date().toISOString());
      if (cancel) return;
      if (!result.ok) {
        setBlock({ message: result.message, issues: result.issues, raw: result.raw });
        setStatus("blocked");
        return;
      }
      libraryRef.current = result.library;
      setLibrary(result.library);
      const trip =
        result.library.trips.find((item) => item.id === result.library.activeTripId) ??
        result.library.trips[0];
      setIndexState(trip ? clampIndex(trip.stops.length, readIndex(trip.id)) : 0);
      if (result.warnings[0]) setWarning(result.warnings[0]);
      setStatus("ready");
    })();
    return () => {
      cancel = true;
    };
  }, [accountMode]);

  const trip =
    library?.trips.find((item) => item.id === library.activeTripId) ?? library?.trips[0] ?? null;

  const persist = useCallback(async (next: Library) => {
    const previous = libraryRef.current;
    libraryRef.current = next;
    setLibrary(next);
    writeActive(next.activeTripId);
    if (accountMode) {
      if (readonly) return;
      savingRef.current = true;
      try {
        await syncAccountLibrary(previous, next);
      } catch (err) {
        setWarning(err instanceof Error ? err.message : "The account could not be saved.");
      } finally {
        savingRef.current = false;
      }
      return;
    }
    try {
      await storeRef.current?.set(LIBRARY_KEY, next);
    } catch {
      setWarning("Could not save to this browser. Export a backup before you leave.");
    }
  }, [accountMode, readonly]);

  const setIndex = useCallback(
    (next: number | ((current: number) => number)) => {
      setIndexState((current) => {
        const resolved = typeof next === "function" ? next(current) : next;
        const length = trip?.stops.length ?? 0;
        const clamped = clampIndex(length, resolved);
        if (trip) writeIndex(trip.id, clamped);
        return clamped;
      });
    },
    [trip],
  );

  const commitTrip = useCallback(
    async (nextTrip: Trip, nextIndex?: number) => {
      if (!library) return ["The trip book is not open yet."];
      if (readonly) return ["This is a shared view. It was not changed."];
      const issues = integrityIssues(nextTrip);
      if (issues.length) return issues;
      const next = saveTrip(library, nextTrip, new Date().toISOString());
      await persist(next);
      if (nextIndex != null) setIndex(nextIndex);
      return null;
    },
    [library, persist, readonly, setIndex],
  );

  useEffect(() => {
    if (!accountMode || readonly || status !== "ready" || !trip) return;
    const tripId = trip.id;
    const seen = trip.updatedAt;
    const timer = window.setInterval(() => {
      if (savingRef.current) return;
      void fetchAccountTrip(tripId)
        .then((remote) => {
          if (!remote || remote.updatedAt <= seen) return;
          const current = libraryRef.current;
          if (!current) return;
          const next = {
            ...current,
            trips: current.trips.map((item) => (item.id === remote.id ? remote : item)),
            updatedAt: remote.updatedAt,
          };
          libraryRef.current = next;
          setLibrary(next);
        })
        .catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [accountMode, readonly, status, trip]);

  const selectTrip = useCallback(
    async (tripId: string) => {
      if (!library) return;
      if (!library.trips.some((item) => item.id === tripId)) return;
      const next = { ...library, activeTripId: tripId, updatedAt: new Date().toISOString() };
      await persist(next);
      const chosen = next.trips.find((item) => item.id === tripId)!;
      setIndexState(clampIndex(chosen.stops.length, readIndex(tripId)));
    },
    [library, persist],
  );

  return {
    status,
    library,
    trip,
    index,
    warning,
    block,
    readonly,
    accountMode,
    dismissWarning: () => setWarning(null),
    signOut() {
      setAccountToken(null);
      libraryRef.current = null;
      setLibrary(null);
      setReadonly(false);
      setStatus("signed-out");
    },
    async signIn(token: string) {
      await openAccount(token.trim());
    },
    setIndex,
    async setMode(mode: LegMode) {
      if (!trip) return;
      const next = setLegMode(trip, index, mode, new Date().toISOString());
      if (next === trip) return;
      await commitTrip(next);
    },
    commitTrip,
    selectTrip,
    async createBlank(input: { name?: string; timezone?: string }) {
      if (!library) return "The trip book is not open yet.";
      if (library.trips.length >= 50) return "This browser already has 50 trips.";
      if (input.timezone && !isValidTimeZone(input.timezone.trim())) {
        return "That time zone was not recognized. Try Asia/Bangkok or Asia/Taipei.";
      }
      const created = blankTrip(new Date().toISOString(), undefined, input);
      await persist(saveTrip(library, created, created.updatedAt));
      setIndexState(0);
      return null;
    },
    async duplicateActive() {
      if (!library || !trip) return;
      if (library.trips.length >= 50) {
        setWarning("This browser already has 50 trips. Export or delete one before duplicating.");
        return;
      }
      const copy = duplicateTrip(trip, new Date().toISOString());
      await persist(saveTrip(library, copy, copy.updatedAt));
      setIndexState(0);
    },
    async removeTrip(tripId: string) {
      if (!library) return;
      const next = deleteTrip(library, tripId, new Date().toISOString());
      await persist(next);
      const chosen = next.trips.find((item) => item.id === next.activeTripId) ?? next.trips[0];
      setIndexState(chosen ? clampIndex(chosen.stops.length, readIndex(chosen.id)) : 0);
    },
    async importTrips(trips: Trip[], mode: ImportCommit) {
      if (!library) return "The trip book is not open yet.";
      const result = applyImport(library, trips, mode, new Date().toISOString());
      if (!result.ok) return result.message;
      await persist(result.library);
      return null;
    },
    async addSample() {
      if (!library) return "The trip book is not open yet.";
      const result = addSampleTrip(library, new Date().toISOString());
      if ("error" in result) return result.error;
      await persist(result);
      setIndexState(0);
      return null;
    },
    async replaceBlocked() {
      const store = storeRef.current;
      if (!store) return;
      const next = sampleLibrary(new Date().toISOString());
      await store.set(LIBRARY_KEY, next);
      setLibrary(next);
      setBlock(null);
      setIndexState(0);
      setStatus("ready");
      setWarning("The unreadable save was replaced with the sample Bangkok trip.");
    },
    exportTrip: () => (trip ? tripDocument(trip, new Date().toISOString()) : null),
    routeCacheGet: (key: string) =>
      storeRef.current
        ? cacheGet<RoutePayload>(storeRef.current, ROUTE_CACHE_KEY, key, ROUTE_TTL_MS)
        : Promise.resolve(undefined),
    routeCacheSet: async (key: string, value: RoutePayload) => {
      if (!storeRef.current) return;
      await cacheSet(storeRef.current, ROUTE_CACHE_KEY, key, value, 80);
    },
    geocodeCacheGet: (key: string) =>
      storeRef.current
        ? cacheGet<GeocodeHit[]>(storeRef.current, GEOCODE_CACHE_KEY, key, ROUTE_TTL_MS)
        : Promise.resolve(undefined),
    geocodeCacheSet: async (key: string, value: GeocodeHit[]) => {
      if (!storeRef.current) return;
      await cacheSet(storeRef.current, GEOCODE_CACHE_KEY, key, value, 40);
    },
    nearbyCacheGet: (key: string) =>
      storeRef.current
        ? cacheGet<NearbyPlace[]>(storeRef.current, NEARBY_CACHE_KEY, key, LOOKUP_TTL_MS)
        : Promise.resolve(undefined),
    nearbyCacheSet: async (key: string, value: NearbyPlace[]) => {
      if (!storeRef.current) return;
      await cacheSet(storeRef.current, NEARBY_CACHE_KEY, key, value, 40);
    },
  };
}
