import { describe, expect, it } from "vitest";
import { absorbAccountTrips } from "@/lib/account";
import { bangkokTrip, sampleLibrary } from "@/lib/seed";

const NOW = "2026-11-11T00:00:00.000Z";

describe("trips saved on the account", () => {
  it("adds a new trip without dropping or switching the open one", () => {
    const library = sampleLibrary(NOW);
    const extra = { ...bangkokTrip(NOW), id: "trip-taiwan", name: "Taiwan", updatedAt: "2026-11-11T13:07:23Z" };
    const merged = absorbAccountTrips(library, [extra], NOW);
    expect(merged.added).toEqual(["Taiwan"]);
    expect(merged.library.trips.map((trip) => trip.id)).toEqual(["trip-taiwan", library.trips[0].id]);
    expect(merged.library.activeTripId).toBe(library.activeTripId);
  });

  it("replaces a trip when the account copy is newer", () => {
    const library = sampleLibrary(NOW);
    const newer = { ...library.trips[0], name: "Bangkok updated", updatedAt: "2026-11-12T00:00:00.000Z" };
    const merged = absorbAccountTrips(library, [newer], NOW);
    expect(merged.added).toEqual([]);
    expect(merged.library.trips[0].name).toBe("Bangkok updated");
  });

  it("leaves the library alone when the account copy is not newer", () => {
    const library = sampleLibrary(NOW);
    const older = { ...library.trips[0], name: "Old name", updatedAt: "2000-01-01T00:00:00.000Z" };
    expect(absorbAccountTrips(library, [older], NOW).library).toBe(library);
  });
});
