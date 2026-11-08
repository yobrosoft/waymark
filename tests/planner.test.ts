import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import Ajv from "ajv";
import {
  addSampleTrip,
  applyImport,
  blankTrip,
  bootstrapLibrary,
  deleteTrip,
  duplicateTrip,
  loadStoredLibrary,
  parseImport,
  reidentify,
} from "@/lib/library";
import { resolveGeocode, resolveNearby } from "@/lib/lookups";
import { buildOsrmUrl, buildOverpassQuery } from "@/lib/providers";
import { parseOsrmBody, resolveRoute, routeCacheKey, routeLine } from "@/lib/routing";
import { BANGKOK, bangkokTrip, sampleLibrary } from "@/lib/seed";
import { librarySchema, tripSchema } from "@/lib/schema";
import { proxyGeocode } from "@/lib/server/proxy-geocode";
import { proxyNearby } from "@/lib/server/proxy-nearby";
import { proxyRoute } from "@/lib/server/proxy-route";
import { memoryStore } from "@/lib/storage";
import {
  applyStopDraft,
  firstStopIndexForDay,
  moveStop,
  selectedLeg,
  selectPinIndex,
  stepIndex,
} from "@/lib/trip-logic";
import type { RoutePayload, Trip } from "@/lib/types";

const NOW = "2026-11-08T00:00:00.000Z";

function trip(): Trip {
  return bangkokTrip(NOW);
}

describe("Bangkok seed", () => {
  it("has 16 ordered stops at 8 places, airport first", () => {
    const sample = trip();
    expect(sample.stops).toHaveLength(16);
    expect(sample.locations).toHaveLength(8);
    expect(new Set(sample.stops.map((stop) => stop.locationId)).size).toBe(8);
    expect(sample.stops[0].locationId).toBe("loc-bkk");
    expect(sample.stops[15].locationId).toBe("loc-bkk");
    expect(sample.locations.find((place) => place.id === "loc-bkk")).toMatchObject(BANGKOK.bkk);
    expect(sample.locations.find((place) => place.id === "loc-chatrium")).toMatchObject(BANGKOK.chatrium);
    expect(sample.locations.find((place) => place.id === "loc-wat-arun")).toMatchObject(BANGKOK.watArun);
    expect(sample.locations.find((place) => place.id === "loc-iconsiam")).toMatchObject(BANGKOK.iconsiam);
    expect(sample.locations.find((place) => place.id === "loc-centralworld")).toMatchObject(BANGKOK.centralWorld);
    expect(sample.locations.find((place) => place.id === "loc-asiatique")).toMatchObject(BANGKOK.asiatique);
    expect(sample.locations.find((place) => place.id === "loc-supanniga")).toMatchObject(BANGKOK.supanniga);
    expect(sample.locations.find((place) => place.id === "loc-baan-khanitha")).toMatchObject(BANGKOK.baanKhanitha);
    expect(sample.status).toBe("proposed");
  });

  it("keeps same-place hotel rests and real transfers apart", () => {
    const sample = trip();
    expect(selectedLeg(sample, 0)).toBeNull();
    expect(selectedLeg(sample, 7)?.samePlace).toBe(true);
    expect(selectedLeg(sample, 12)?.samePlace).toBe(true);
    expect(selectedLeg(sample, 1)?.samePlace).toBe(false);
    expect(selectedLeg(sample, 4)?.samePlace).toBe(false);
    expect(selectedLeg(sample, 1)?.from.name).toMatch(/Airport/);
    expect(selectedLeg(sample, 1)?.to.name).toMatch(/Chatrium/);
    const same = sample.stops.filter((stop) => stop.status === "buffer").map((stop) => stop.id);
    expect(same).toEqual(["stop-08", "stop-13"]);
  });

  it("does not carry personal or booking claims", () => {
    const blob = JSON.stringify(sampleLibrary(NOW)).toLowerCase();
    for (const word of ["joel", "nicole", "passport", "api_key", "secret", "years old", "usd", "sgd"]) {
      expect(blob.includes(word)).toBe(false);
    }
    expect(blob).toContain("not booked");
    expect(tripSchema.safeParse(trip()).success).toBe(true);
  });
});

describe("wizard state", () => {
  const sample = trip();

  it("steps, resets, and stops at the ends", () => {
    expect(stepIndex(16, 0, -1)).toBe(0);
    expect(stepIndex(16, 15, 1)).toBe(15);
    expect(stepIndex(16, 0, 1)).toBe(1);
    expect(stepIndex(16, 4, 0)).toBe(4);
  });

  it("jumps to the first stop of a day", () => {
    expect(firstStopIndexForDay(sample, "day-2026-12-08")).toBe(0);
    expect(firstStopIndexForDay(sample, "day-2026-12-10")).toBe(5);
    expect(firstStopIndexForDay(sample, "day-2026-12-14")).toBe(15);
    expect(firstStopIndexForDay(sample, "missing")).toBe(-1);
  });

  it("picks the next visit of a repeated place, then wraps", () => {
    expect(selectPinIndex(sample, 0, "loc-chatrium")).toBe(1);
    expect(selectPinIndex(sample, 1, "loc-chatrium")).toBe(4);
    expect(selectPinIndex(sample, 14, "loc-chatrium")).toBe(1);
    expect(selectPinIndex(sample, 2, "loc-bkk")).toBe(15);
    expect(selectPinIndex(sample, 15, "loc-bkk")).toBe(0);
  });

  it("recomputes same-place after a reorder", () => {
    const moved = moveStop(sample, 7, 1, NOW);
    expect(selectedLeg(moved, 7)?.samePlace).toBe(false);
    expect(selectedLeg(moved, 8)?.to.name).toMatch(/Chatrium/);
  });
});

describe("stop editing", () => {
  it("updates a shared hotel pin for every visit unless the stop is split", () => {
    const sample = trip();
    let ids = 0;
    const nextId = (prefix: string) => `${prefix}-${++ids}`;
    const hotel = sample.locations.find((place) => place.id === "loc-chatrium")!;
    const edited = applyStopDraft(
      sample,
      {
        stopId: "stop-02",
        dayId: "day-2026-12-08",
        plannedTime: "Late",
        status: "proposed",
        notes: "Kept",
        access: "Caveat",
        reuseLocationId: null,
        detach: false,
        name: "Chatrium renamed",
        address: hotel.address,
        lat: String(hotel.lat),
        lon: String(hotel.lon),
        pinNote: hotel.pinNote,
      },
      null,
      NOW,
      nextId,
    );
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(edited.trip.locations.filter((place) => place.name === "Chatrium renamed")).toHaveLength(1);
    expect(edited.trip.stops.filter((stop) => stop.locationId === "loc-chatrium")).toHaveLength(8);

    const split = applyStopDraft(
      edited.trip,
      {
        stopId: "stop-02",
        dayId: "day-2026-12-08",
        plannedTime: "Late",
        status: "proposed",
        notes: "Kept",
        access: "Caveat",
        reuseLocationId: null,
        detach: true,
        name: "Chatrium door",
        address: hotel.address,
        lat: String(hotel.lat + 0.01),
        lon: String(hotel.lon),
        pinNote: "Only this arrival",
      },
      null,
      NOW,
      nextId,
    );
    expect(split.ok).toBe(true);
    if (!split.ok) return;
    const arrival = split.trip.stops.find((stop) => stop.id === "stop-02")!;
    expect(arrival.locationId).not.toBe("loc-chatrium");
    expect(split.trip.stops.filter((stop) => stop.locationId === "loc-chatrium")).toHaveLength(7);
    expect(selectedLeg(split.trip, 1)?.samePlace).toBe(false);
  });

  it("reuses a saved place for a new stop without moving it", () => {
    const sample = trip();
    const applied = applyStopDraft(
      sample,
      {
        stopId: null,
        dayId: "day-2026-12-09",
        plannedTime: "Evening",
        status: "proposed",
        notes: "",
        access: "",
        reuseLocationId: "loc-chatrium",
        detach: false,
        name: "",
        address: "",
        lat: "",
        lon: "",
        pinNote: "",
      },
      5,
      NOW,
      () => "unused",
    );
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.index).toBe(5);
    expect(applied.trip.stops[5].locationId).toBe("loc-chatrium");
    expect(applied.trip.locations).toHaveLength(8);
  });

  it("rejects a latitude that is not a coordinate", () => {
    const applied = applyStopDraft(
      trip(),
      {
        stopId: null,
        dayId: "day-2026-12-08",
        plannedTime: "",
        status: "proposed",
        notes: "",
        access: "",
        reuseLocationId: null,
        detach: false,
        name: "Somewhere",
        address: "",
        lat: "north",
        lon: "100",
        pinNote: "",
      },
      1,
      NOW,
      (prefix) => `${prefix}-x`,
    );
    expect(applied.ok).toBe(false);
  });
});

describe("import, migration, and persistence", () => {
  it("seeds only an empty store and will not overwrite edits or a future version", async () => {
    const store = memoryStore();
    const first = await bootstrapLibrary(store, NOW);
    expect(first.ok && first.seeded).toBe(true);
    if (!first.ok) return;
    const edited = {
      ...first.library,
      trips: first.library.trips.map((item) => ({ ...item, name: "My edited Bangkok" })),
    };
    await store.set("library", edited);
    const second = await bootstrapLibrary(store, "2026-11-09T00:00:00.000Z");
    expect(second.ok && second.seeded).toBe(false);
    if (!second.ok) return;
    expect(second.library.trips[0].name).toBe("My edited Bangkok");

    const future = memoryStore({ library: { schemaVersion: 9, trips: [{ name: "newer" }] } });
    const blocked = await bootstrapLibrary(future, NOW);
    expect(blocked.ok).toBe(false);
    expect(await future.get("library")).toMatchObject({ schemaVersion: 9 });

    const emptied = deleteTrip(second.library, second.library.trips[0].id, NOW);
    await store.set("library", emptied);
    const third = await bootstrapLibrary(store, NOW);
    expect(third.ok && third.seeded).toBe(false);
    if (!third.ok) return;
    expect(third.library.trips).toHaveLength(0);
  });

  it("rejects malformed files and does not commit them", () => {
    expect(parseImport("{").ok).toBe(false);
    expect(parseImport("null").ok).toBe(false);
    const bad = parseImport(JSON.stringify({ schemaVersion: 1, kind: "waymark.library", trips: [{ name: "" }] }));
    expect(bad.ok).toBe(false);
    const poison = JSON.parse('{"schemaVersion":1,"kind":"waymark.trip","__proto__":{"admin":true}}');
    expect(parseImport(JSON.stringify(poison)).ok).toBe(false);
    expect((Object.prototype as { admin?: boolean }).admin).toBeUndefined();

    const library = sampleLibrary(NOW);
    const broken = parseImport('{"schemaVersion":99,"kind":"waymark.library","trips":[]}');
    expect(broken.ok).toBe(false);
    expect(library.trips[0].name).toMatch(/Bangkok/);
  });

  it("copies imports without touching existing trips unless replace is chosen", () => {
    const library = sampleLibrary(NOW);
    const incoming = reidentify(library.trips[0], NOW, (prefix) => `${prefix}-new`, "Imported");
    const copied = applyImport(library, [incoming], "copy", NOW, (prefix) => `${prefix}-copy`);
    expect(copied.ok).toBe(true);
    if (!copied.ok) return;
    expect(copied.library.trips[0]).toEqual(library.trips[0]);
    expect(copied.library.trips).toHaveLength(2);
    expect(copied.library.trips[1].id).not.toBe(library.trips[0].id);

    const replacement = { ...library.trips[0], summary: "Replaced on purpose" };
    const replaced = applyImport(library, [replacement], "replace", NOW);
    expect(replaced.ok).toBe(true);
    if (!replaced.ok) return;
    expect(replaced.replaced).toBe(1);
    expect(replaced.library.trips).toHaveLength(1);
    expect(replaced.library.trips[0].summary).toBe("Replaced on purpose");
  });

  it("adds another sample without fabricating a second destination", () => {
    const library = sampleLibrary(NOW);
    const added = addSampleTrip(library, NOW, (prefix) => `${prefix}-again`);
    expect("trips" in added).toBe(true);
    if (!("trips" in added)) return;
    expect(added.trips).toHaveLength(2);
    expect(added.trips[0].name).toBe(library.trips[0].name);
    expect(added.trips[1].name).toMatch(/Bangkok/);
    expect(blankTrip(NOW, (prefix) => `${prefix}-b`).stops).toHaveLength(0);
  });

  it("duplicates with new ids and keeps the leg mode", () => {
    const copy = duplicateTrip(trip(), NOW, (prefix) => `${prefix}-d`);
    expect(copy.id).not.toBe("trip-bangkok-2026-12-08");
    expect(copy.stops[0].id).not.toBe("stop-01");
    expect(copy.name.startsWith("Copy of")).toBe(true);
    expect(selectedLeg(copy, 1)?.mode).toBe("driving");
    expect(selectedLeg(copy, 7)?.samePlace).toBe(true);
  });

  it("leaves a dangling active trip pointer unrepaired on disk", () => {
    const library = sampleLibrary(NOW);
    const loaded = loadStoredLibrary({ ...library, activeTripId: "missing" });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.library.activeTripId).toBe(library.trips[0].id);
    expect(loaded.warnings.join(" ")).toMatch(/without changing trip contents/);
  });
});

describe("routing honesty", () => {
  const bend = {
    code: "Ok",
    routes: [
      {
        distance: 1200,
        duration: 180,
        geometry: {
          type: "LineString",
          coordinates: [
            [100.5, 13.7],
            [100.55, 13.8],
            [100.62, 13.74],
          ],
        },
      },
    ],
  };

  it("uses the service geometry and refuses to invent a line", () => {
    const parsed = parseOsrmBody(bend, "driving", NOW);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.route.geometry.coordinates).toEqual(bend.routes[0].geometry.coordinates);
    expect(parsed.route.traffic).toBe("not-live");
    const missing = parseOsrmBody({ code: "NoRoute", message: "NoRoute" }, "walking", NOW);
    expect(missing.ok).toBe(false);
    expect(routeLine({ status: "error", message: "no" })).toBeNull();
    expect(routeLine({ status: "same-place" })).toBeNull();
    if (!missing.ok) expect(missing.error).toMatch(/not substituted/i);
  });

  it("does not call the router for a same-place leg and caches a real one", async () => {
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return Response.json({ ok: true, route: parseOsrmBody(bend, "driving", NOW) });
    };
    const cache = new Map<string, RoutePayload>();
    const same = await resolveRoute({
      samePlace: true,
      mode: "driving",
      from: BANGKOK.chatrium,
      to: BANGKOK.chatrium,
      cacheGet: async () => undefined,
      cacheSet: async () => undefined,
      fetcher: fetcher as typeof fetch,
    });
    expect(same.status).toBe("same-place");
    expect(calls).toBe(0);

    const failed = await resolveRoute({
      samePlace: false,
      mode: "driving",
      from: BANGKOK.bkk,
      to: BANGKOK.chatrium,
      cacheGet: async () => undefined,
      cacheSet: async () => undefined,
      fetcher: (async () => new Response("nope", { status: 502 })) as typeof fetch,
    });
    expect(failed.status).toBe("error");
    if (failed.status === "error") expect(routeLine(failed)).toBeNull();

    const parsed = parseOsrmBody(bend, "driving", NOW);
    if (!parsed.ok) throw new Error("fixture");
    const ok = await resolveRoute({
      samePlace: false,
      mode: "driving",
      from: { lat: 13.7, lon: 100.5 },
      to: { lat: 13.74, lon: 100.62 },
      cacheGet: async (key) => cache.get(key),
      cacheSet: async (key, value) => {
        cache.set(key, value);
      },
      fetcher: (async () => Response.json(bend)) as typeof fetch,
    });
    expect(ok.status).toBe("ready");
    if (ok.status === "ready") {
      expect(ok.route.geometry.coordinates[1]).toEqual([100.55, 13.8]);
      expect(ok.fromCache).toBe(false);
    }
    const again = await resolveRoute({
      samePlace: false,
      mode: "driving",
      from: { lat: 13.7, lon: 100.5 },
      to: { lat: 13.74, lon: 100.62 },
      cacheGet: async (key) => cache.get(key),
      cacheSet: async () => {
        throw new Error("should not write");
      },
      fetcher: (async () => {
        calls += 1;
        return Response.json({});
      }) as typeof fetch,
    });
    expect(again.status).toBe("ready");
    if (again.status === "ready") expect(again.fromCache).toBe(true);
    expect(routeCacheKey("driving", BANGKOK.bkk, BANGKOK.chatrium)).toContain("driving");
  });

  it("builds the FOSSGIS car and foot URLs in lon,lat order", () => {
    expect(buildOsrmUrl("driving", BANGKOK.bkk, BANGKOK.chatrium)).toContain(
      "/routed-car/route/v1/driving/100.746861,13.681895;100.53755,13.702567",
    );
    expect(buildOsrmUrl("walking", BANGKOK.chatrium, BANGKOK.supanniga)).toContain("/routed-foot/route/v1/foot/");
    expect(buildOsrmUrl("cycling", BANGKOK.chatrium, BANGKOK.supanniga)).toContain("/routed-bike/route/v1/bike/");
    const query = buildOverpassQuery("pharmacy", BANGKOK.chatrium);
    expect(query).toContain('nwr["amenity"="pharmacy"]');
    expect(query).not.toContain("<script");
  });

  it("proxies failures without a fallback line and blocks bad requests", async () => {
    const schedule = <T,>(task: () => Promise<T>) => task();
    let called = 0;
    const fetcher = (async () => {
      called += 1;
      return Response.json(bend);
    }) as typeof fetch;
    const bad = await proxyRoute(new URLSearchParams({ mode: "transit" }), fetcher, schedule);
    expect(bad.status).toBe(400);
    expect(called).toBe(0);
    expect(JSON.stringify(bad.body)).not.toContain("LineString");

    const same = await proxyRoute(
      new URLSearchParams({
        mode: "driving",
        fromLat: "13.7",
        fromLon: "100.5",
        toLat: "13.7",
        toLon: "100.5",
      }),
      fetcher,
      schedule,
    );
    expect(same.body).toMatchObject({ ok: true, samePlace: true });
    expect(called).toBe(0);

    const down = await proxyRoute(
      new URLSearchParams({
        mode: "walking",
        fromLat: "13.70",
        fromLon: "100.50",
        toLat: "13.75",
        toLon: "100.55",
      }),
      (async () => new Response("busy", { status: 503 })) as typeof fetch,
      schedule,
    );
    expect(down.status).toBe(502);
    expect(down.body).toMatchObject({ ok: false });
    expect(JSON.stringify(down.body)).not.toContain("coordinates");

    const ok = await proxyRoute(
      new URLSearchParams({
        mode: "driving",
        fromLat: "13.681895",
        fromLon: "100.746861",
        toLat: "13.702567",
        toLon: "100.53755",
      }),
      (async () => Response.json(bend)) as typeof fetch,
      schedule,
    );
    expect(ok.status).toBe(200);
    const route = (ok.body as { route: RoutePayload }).route;
    expect(route.geometry.coordinates[1]).toEqual([100.55, 13.8]);
    expect(route.provider).toBe("fossgis-osrm");
  });
});

describe("geocoding and nearby", () => {
  it("does not change coordinates when search fails, and caches hits", async () => {
    const missed = await resolveGeocode({
      query: "Chatrium",
      cacheGet: async () => undefined,
      cacheSet: async () => undefined,
      fetcher: (async () => Response.json({ ok: false, error: "Address search failed (HTTP 502). Coordinates were not changed." }, { status: 502 })) as typeof fetch,
    });
    expect(missed.ok).toBe(false);
    const cache = new Map<string, { label: string; lat: number; lon: number }[]>();
    const hit = [{ label: "Chatrium Residence Sathon", lat: 13.7, lon: 100.53 }];
    const first = await resolveGeocode({
      query: "Chatrium",
      cacheGet: async (key) => cache.get(key),
      cacheSet: async (key, value) => {
        cache.set(key, value);
      },
      fetcher: (async () => Response.json({ ok: true, results: hit })) as typeof fetch,
    });
    expect(first).toMatchObject({ ok: true, fromCache: false });
    let calls = 0;
    const second = await resolveGeocode({
      query: "Chatrium",
      cacheGet: async (key) => cache.get(key),
      cacheSet: async () => undefined,
      fetcher: (async () => {
        calls += 1;
        return Response.json({ ok: true, results: [] });
      }) as typeof fetch,
    });
    expect(calls).toBe(0);
    expect(second.ok && second.fromCache).toBe(true);

    const rejected = await proxyGeocode(" ", async () => {
      throw new Error("should not fetch");
    }, (task) => task());
    expect(rejected.status).toBe(400);
  });

  it("reports a nearby outage instead of an empty invented list", async () => {
    const failed = await proxyNearby(
      new URLSearchParams({ category: "pharmacy", lat: "13.702567", lon: "100.53755" }),
      (async () => new Response("down", { status: 503 })) as typeof fetch,
      (task) => task(),
    );
    expect(failed.body).toMatchObject({ ok: false });
    expect(JSON.stringify(failed.body)).toMatch(/Nothing was invented/);
    expect((failed.body as { places?: unknown }).places).toBeUndefined();

    const parsed = await proxyNearby(
      new URLSearchParams({ category: "cafe", lat: "13.726694", lon: "100.510498" }),
      (async () =>
        Response.json({
          elements: [
            { type: "node", id: 10, lat: 13.727, lon: 100.511, tags: { name: "Riverside Cafe", amenity: "cafe" } },
            { type: "node", id: 11, lat: 13.8, lon: 100.6, tags: { amenity: "cafe" } },
          ],
        })) as typeof fetch,
      (task) => task(),
    );
    const places = (parsed.body as { places: { name: string; straightLineMeters: number }[] }).places;
    expect(places).toHaveLength(1);
    expect(places[0].name).toBe("Riverside Cafe");
    expect(places[0].straightLineMeters).toBeGreaterThan(0);

    const remark = await proxyNearby(
      new URLSearchParams({ category: "food", lat: "13.7", lon: "100.5" }),
      (async () => Response.json({ remark: "runtime error" })) as typeof fetch,
      (task) => task(),
    );
    expect(remark.body).toMatchObject({ ok: false });

    const cached = await resolveNearby({
      category: "food",
      lat: 13.7,
      lon: 100.5,
      cacheGet: async () => [],
      cacheSet: async () => undefined,
      fetcher: (async () => {
        throw new Error("should use cache");
      }) as typeof fetch,
    });
    expect(cached.ok).toBe(true);
  });
});

describe("published schema", () => {
  it("accepts the sample library and rejects a bad coordinate", () => {
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(JSON.parse(readFileSync("schema/waymark-library.schema.json", "utf8")));
    const library = sampleLibrary(NOW);
    expect(validate(library)).toBe(true);
    expect(librarySchema.safeParse(library).success).toBe(true);
    const broken = structuredClone(library);
    broken.trips[0].locations[0].lat = 120;
    expect(validate(broken)).toBe(false);
    expect(librarySchema.safeParse(broken).success).toBe(false);
  });
});
