import { describe, expect, it } from "vitest";
import { parseTransitRoute, transitDeparture, transitServices, zonedDateTime } from "@/lib/transit";
import { resolveRoute, routeCacheKey } from "@/lib/routing";

const NOW = new Date("2026-11-11T04:00:00.000Z");

describe("public transport departure", () => {
  it("uses a clock time in the trip timezone", () => {
    const at = zonedDateTime("2026-12-08", 9, 30, "Asia/Bangkok");
    expect(at?.toISOString()).toBe("2026-12-08T02:30:00.000Z");
    const when = transitDeparture({
      date: "2026-12-08",
      plannedTime: "Land around 09:30",
      timeZone: "Asia/Bangkok",
      now: NOW,
    });
    expect(when.ok).toBe(true);
    if (!when.ok) return;
    expect(when.at.toISOString()).toBe("2026-12-08T02:30:00.000Z");
    expect(when.note).toContain("09:30");
    expect(when.cacheKey).toBe("2026-12-08T02:30");
  });

  it("uses noon and says so when the stop has no clock", () => {
    const when = transitDeparture({
      date: "2026-12-08",
      plannedTime: "Evening",
      timeZone: "Asia/Bangkok",
      now: NOW,
    });
    expect(when.ok).toBe(true);
    if (!when.ok) return;
    expect(when.at.toISOString()).toBe("2026-12-08T05:00:00.000Z");
    expect(when.note).toContain("12:00");
  });

  it("refuses a stop more than 100 days ahead", () => {
    const when = transitDeparture({
      date: "2027-04-01",
      plannedTime: "09:00",
      timeZone: "Asia/Bangkok",
      now: NOW,
    });
    expect(when.ok).toBe(false);
  });
});

describe("public transport route", () => {
  it("keeps Google's line and does not invent a path", () => {
    const services = transitServices([
      { travelMode: "WALKING" },
      { travelMode: "TRANSIT", line: "BTS Silom" },
      { travelMode: "WALKING" },
    ]);
    expect(services).toBe("Walk · BTS Silom · Walk");
    const parsed = parseTransitRoute(
      {
        distanceMeters: 4200,
        durationMillis: 25 * 60 * 1000,
        path: [
          { lat: 13.72, lng: 100.52 },
          { lat: 13.73, lng: 100.53 },
        ],
        steps: [
          { travelMode: "WALKING" },
          { travelMode: "TRANSIT", line: "BTS Silom" },
        ],
      },
      "2026-11-11T04:00:00.000Z",
      "Leaving Tue 8 Dec, 09:30",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.route.provider).toBe("google-transit");
    expect(parsed.route.durationSeconds).toBe(1500);
    expect(parsed.route.geometry.coordinates).toEqual([
      [100.52, 13.72],
      [100.53, 13.73],
    ]);
    expect(parsed.route.summary).toContain("BTS Silom");
    const missing = parseTransitRoute(
      { distanceMeters: 10, durationMillis: 10, path: [{ lat: 1, lng: 2 }], steps: [] },
      "2026-11-11T04:00:00.000Z",
      "Leaving now",
    );
    expect(missing.ok).toBe(false);
  });

  it("asks Google instead of OSRM", async () => {
    let osrm = 0;
    const fetcher = (async () => {
      osrm += 1;
      return Response.json({});
    }) as typeof fetch;
    const result = await resolveRoute({
      samePlace: false,
      mode: "transit",
      from: { lat: 13.72, lon: 100.52 },
      to: { lat: 13.73, lon: 100.54 },
      departAt: "2026-12-08T02:30:00.000Z",
      transitKey: "2026-12-08T02:30",
      departureNote: "Leaving Tue 8 Dec, 09:30",
      cacheGet: async () => undefined,
      cacheSet: async () => undefined,
      fetcher,
      fetchTransit: async () =>
        parseTransitRoute(
          {
            distanceMeters: 1800,
            durationMillis: 900000,
            path: [
              { lat: 13.72, lng: 100.52 },
              { lat: 13.725, lng: 100.53 },
              { lat: 13.73, lng: 100.54 },
            ],
            steps: [{ travelMode: "TRANSIT", line: "BTS" }],
          },
          "2026-11-11T04:00:00.000Z",
          "Leaving Tue 8 Dec, 09:30",
        ),
    });
    expect(osrm).toBe(0);
    expect(result.status).toBe("ready");
    if (result.status === "ready") expect(result.route.summary).toContain("BTS");
    expect(routeCacheKey("transit", { lat: 13.72, lon: 100.52 }, { lat: 13.73, lon: 100.54 }, "2026-12-08T02:30")).toContain(
      "transit",
    );
  });
});
