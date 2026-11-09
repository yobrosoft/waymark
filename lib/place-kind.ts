export type PlaceKind =
  | "airport"
  | "hotel"
  | "restaurant"
  | "cafe"
  | "temple"
  | "shopping"
  | "sight"
  | "transit"
  | "health"
  | "park"
  | "bar"
  | "place";

const LABELS: Record<PlaceKind, string> = {
  airport: "Airport",
  hotel: "Hotel",
  restaurant: "Restaurant",
  cafe: "Cafe",
  temple: "Temple",
  shopping: "Shopping",
  sight: "Sight",
  transit: "Transit",
  health: "Health",
  park: "Park",
  bar: "Bar",
  place: "Place",
};

const RULES: { kind: PlaceKind; pattern: RegExp }[] = [
  { kind: "airport", pattern: /\b(airports?|airfields?|aerodromes?|terminals?)\b/i },
  { kind: "hotel", pattern: /\b(hotels?|hostels?|resorts?|homestays?|residences?|guest ?houses?|home base|check-in)\b/i },
  { kind: "temple", pattern: /\b(temples?|wats?|shrines?|mosques?|churches|cathedrals?|chapels?)\b/i },
  { kind: "shopping", pattern: /\b(malls?|shopping|markets?|department stores?|complex(?:es)?|supermarkets?|convenience)\b/i },
  { kind: "transit", pattern: /\b(stations?|railways?|metros?|subways?|bus stops?)\b|\b(bts|mrt)\b/i },
  { kind: "park", pattern: /\b(parks?|gardens?|beaches|waterfalls?)\b/i },
  { kind: "sight", pattern: /\b(museums?|galleries|palaces?|viewpoints?|attractions?|monuments?)\b/i },
  { kind: "health", pattern: /\b(pharmacies|pharmacy|hospitals?|clinics?|dentists?)\b/i },
  { kind: "cafe", pattern: /\b(cafes?|cafés?|coffee|tea rooms?|tea houses?)\b/i },
  {
    kind: "restaurant",
    pattern: /\b(restaurants?|eating rooms?|eateries|bistros?|diners?|fast[- ]?foods?|food courts?|kitchens?|lunch|dinner|breakfast)\b/i,
  },
  { kind: "bar", pattern: /\b(bars?|pubs?|nightclubs?|nightlife)\b/i },
];

const ICONS: Record<PlaceKind, string> = {
  airport:
    '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
  hotel:
    '<path d="M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8"/><path d="M4 10V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4"/><path d="M12 4v6"/><path d="M2 18h20"/>',
  restaurant:
    '<path d="M3 2v7c0 1.1.9 2 2 2h0a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
  cafe:
    '<path d="M10 2v2"/><path d="M14 2v2"/><path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/>',
  temple:
    '<path d="M3 22h18"/><path d="m4 22 8-18 8 18"/><path d="M8 22v-6h8v6"/><path d="M9 10h6"/>',
  shopping:
    '<path d="M6 7h12l-1 14H7L6 7z"/><path d="M9 7a3 3 0 0 1 6 0"/>',
  sight:
    '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  transit:
    '<rect x="4" y="3" width="16" height="16" rx="2"/><path d="M4 11h16"/><path d="M12 3v8"/><circle cx="8.5" cy="15" r=".8" fill="currentColor" stroke="none"/><circle cx="15.5" cy="15" r=".8" fill="currentColor" stroke="none"/><path d="m8 19-2 3"/><path d="m16 19 2 3"/>',
  health:
    '<circle cx="12" cy="12" r="9"/><path d="M12 8v8"/><path d="M8 12h8"/>',
  park:
    '<path d="M12 22v-7"/><path d="M12 15c-4 0-6-2.5-6-6 2.2 0 3.2-2 6-6 2.8 4 3.8 6 6 6 0 3.5-2 6-6 6z"/>',
  bar:
    '<path d="M8 22h8"/><path d="M12 15v7"/><path d="M7 3h10l-1.2 7.2a4 4 0 0 1-7.6 0Z"/>',
  place:
    '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
};

export function placeKindLabel(kind: PlaceKind): string {
  return LABELS[kind];
}

export function placeIconSvg(kind: PlaceKind): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[kind]}</svg>`;
}

function matchKind(text: string): PlaceKind | null {
  const value = text.trim();
  if (!value) return null;
  for (const rule of RULES) {
    if (rule.pattern.test(value)) return rule.kind;
  }
  return null;
}

function withoutDenials(value: string): string {
  return value.replace(/\b(?:not|no|n't)\s+(?:an?\s+|the\s+)?(?:[a-z]+(?:[- ][a-z]+){0,3})/gi, " ");
}

/** Name wins, then address, then notes. A denial such as "not a clinic" is ignored. */
export function classifyPlace(input: {
  name: string;
  address?: string;
  pinNote?: string;
  notes?: string;
}): PlaceKind {
  return (
    matchKind(input.name) ??
    matchKind(input.address ?? "") ??
    matchKind(withoutDenials(input.pinNote ?? "")) ??
    matchKind(withoutDenials(input.notes ?? "")) ??
    "place"
  );
}
