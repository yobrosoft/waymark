import { describe, expect, it } from "vitest";
import { approximateTime, nightCount, nightLabel } from "@/lib/format";

describe("timeline labels", () => {
  it("uses the first clock time when the note has one", () => {
    expect(approximateTime("10:30–11:30")).toBe("10:30");
    expect(approximateTime("Leave about 10:00")).toBe("10:00");
    expect(approximateTime("16:15 shops, tea room about 17:30")).toBe("16:15");
    expect(approximateTime("Midday rest, leave about 15:15")).toBe("15:15");
  });

  it("falls back to a time of day", () => {
    expect(approximateTime("Evening arrival (search assumption, not a booked ticket)")).toBe("Evening");
    expect(approximateTime("Late evening, after the airport ride")).toBe("Late");
    expect(approximateTime("Afternoon rest, dinner at the hotel")).toBe("Afternoon");
    expect(approximateTime("Rest day, lunch at the hotel")).toBe("Lunch");
    expect(approximateTime("After dinner")).toBe("Night");
    expect(approximateTime("Unresolved")).toBe("—");
    expect(approximateTime("")).toBe("—");
  });

  it("counts nights between calendar dates", () => {
    expect(nightCount("2026-12-08", "2026-12-09")).toBe(1);
    expect(nightLabel(1)).toBe("Night");
    expect(nightCount("2026-12-08", "2026-12-10")).toBe(2);
    expect(nightLabel(2)).toBe("2 nights");
    expect(nightCount("2026-12-09", "2026-12-08")).toBeNull();
    expect(nightLabel(null)).toBe("Night");
  });
});
