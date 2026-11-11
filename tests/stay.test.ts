import { describe, expect, it } from "vitest";
import { bangkokTrip } from "@/lib/seed";
import { statedMinutes, stayEstimate, stayPhrase } from "@/lib/stay";
import { mapPlaces } from "@/lib/trip-logic";

const NOW = "2026-11-11T00:00:00.000Z";

describe("time at a place", () => {
  const trip = bangkokTrip(NOW);

  it("uses the longer end of a written range", () => {
    expect(statedMinutes("Allow 60–120 minutes after landing")).toBe(120);
    expect(statedMinutes("10:30–11:30")).toBe(60);
    const airport = stayEstimate(trip, 0);
    expect(airport).toMatchObject({ label: "2 h", minutes: 120, source: "planned" });
    expect(stayPhrase(airport!)).toBe("2 h here");
  });

  it("keeps a same-day clock window", () => {
    expect(stayEstimate(trip, 2)).toMatchObject({ label: "1 h", minutes: 60, source: "planned" });
  });

  it("treats a hotel you do not leave until the next day as overnight", () => {
    expect(stayEstimate(trip, 1)).toMatchObject({ label: "Overnight", source: "planned" });
  });

  it("estimates a long visit when the plan gives no window", () => {
    const lunch = stayEstimate(trip, 3);
    expect(lunch).toMatchObject({ label: "3 h", minutes: 180, source: "estimated" });
    expect(stayPhrase(lunch!)).toBe("About 3 h here");
  });

  it("puts that time on the larger next pin, not the place you are leaving", () => {
    const pins = mapPlaces(trip, 2);
    const next = pins.find((pin) => pin.name === "Wat Arun");
    const from = pins.find((pin) => pin.name === "Chatrium Residence Sathon");
    expect(next).toMatchObject({ emphasis: "next", stay: "1 h" });
    expect(from).toMatchObject({ emphasis: "from", stay: "" });
  });
});
