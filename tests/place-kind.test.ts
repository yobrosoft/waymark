import { describe, expect, it } from "vitest";
import { classifyPlace, placeKindLabel } from "@/lib/place-kind";
import { bangkokTrip } from "@/lib/seed";
import { mapPlaces } from "@/lib/trip-logic";

const NOW = "2026-11-08T00:00:00.000Z";

describe("place kinds", () => {
  it("labels the Bangkok stops from their names and pin notes", () => {
    const kinds = Object.fromEntries(mapPlaces(bangkokTrip(NOW), 0).map((place) => [place.name, place.kind]));
    expect(kinds).toEqual({
      "Suvarnabhumi Airport (BKK)": "airport",
      "Chatrium Residence Sathon": "hotel",
      "Wat Arun": "temple",
      ICONSIAM: "shopping",
      CentralWorld: "shopping",
      "Asiatique The Riverfront": "shopping",
      "Supanniga Eating Room, Sathorn 10": "restaurant",
      "Baan Khanitha Sathorn": "restaurant",
    });
  });

  it("ignores a denial such as not a clinic", () => {
    expect(
      classifyPlace({
        name: "CentralWorld",
        pinNote: "Complex-level pin. Not a shop entrance, and not a clinic.",
      }),
    ).toBe("shopping");
  });

  it("keeps a named hotel when the stay mentions dinner", () => {
    expect(
      classifyPlace({
        name: "Chatrium Residence Sathon",
        notes: "Eat at the property. No restaurant stop is planned tonight.",
      }),
    ).toBe("hotel");
  });

  it("uses a meal word when the name has no type", () => {
    expect(classifyPlace({ name: "Nara", notes: "Lunch proposal" })).toBe("restaurant");
    expect(classifyPlace({ name: "Riverside", notes: "cafe" })).toBe("cafe");
  });

  it("names each kind in a word", () => {
    expect(placeKindLabel("airport")).toBe("Airport");
    expect(placeKindLabel("temple")).toBe("Temple");
    expect(placeKindLabel("place")).toBe("Place");
  });
});
