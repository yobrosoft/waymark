import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { bootstrapLibrary } from "@/lib/library";
import { idbStore, LIBRARY_KEY } from "@/lib/storage";

describe("IndexedDB trip book", () => {
  it("keeps an edited trip across a reload and does not reseed it", async () => {
    const opened = await bootstrapLibrary(idbStore, "2026-11-08T00:00:00.000Z");
    expect(opened.ok && opened.seeded).toBe(true);
    if (!opened.ok) return;
    const saved = {
      ...opened.library,
      trips: opened.library.trips.map((trip) => ({ ...trip, summary: "Edited on this device" })),
    };
    await idbStore.set(LIBRARY_KEY, saved);
    const again = await bootstrapLibrary(idbStore, "2026-11-08T02:00:00.000Z");
    expect(again.ok && again.seeded).toBe(false);
    if (!again.ok) return;
    expect(again.library.trips[0].summary).toBe("Edited on this device");
    expect(again.library.trips[0].stops).toHaveLength(16);
  });
});
