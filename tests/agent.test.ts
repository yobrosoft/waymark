import { describe, expect, it } from "vitest";
import { diffTrips } from "@/lib/agent-diff";
import {
  createSession,
  decideSuggestion,
  emptyBook,
  proposeTrip,
  saveAccepted,
  samePlan,
} from "@/lib/agent-session";
import { bangkokTrip } from "@/lib/seed";
import type { Trip } from "@/lib/types";

const NOW = "2026-11-08T12:00:00.000Z";
const LATER = "2026-11-08T12:05:00.000Z";

function open() {
  const created = createSession(emptyBook(), bangkokTrip(NOW), NOW, "token-token-token-token");
  if (!created.ok) throw new Error(created.error);
  return created;
}

function withNote(trip: Trip, note: string): Trip {
  return {
    ...trip,
    stops: trip.stops.map((stop, index) => (index === 2 ? { ...stop, notes: note } : stop)),
  };
}

describe("agent suggestions", () => {
  it("stores a suggestion without replacing the saved trip", () => {
    const created = open();
    const next = withNote(created.session.accepted, "Ground level only, recheck the stairs.");
    const proposed = proposeTrip(
      created.book,
      created.session.token,
      { basedOnRevision: 1, summary: "Clarified the Wat Arun access note.", trip: next },
      LATER,
      "sug-1",
    );
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;
    expect(proposed.session.accepted.stops[2].notes).toBe(created.session.accepted.stops[2].notes);
    expect(proposed.session.pending?.trip.stops[2].notes).toMatch(/stairs/);
    expect(proposed.session.revision).toBe(1);
    const changes = diffTrips(proposed.session.accepted, proposed.session.pending!.trip);
    expect(changes.some((change) => change.text.includes("Wat Arun"))).toBe(true);
  });

  it("rejects a stale revision and an invalid trip without storing either", () => {
    const created = open();
    const stale = proposeTrip(
      created.book,
      created.session.token,
      { basedOnRevision: 0, summary: "Too old.", trip: created.session.accepted },
      LATER,
      "sug-old",
    );
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.status).toBe(409);
    expect(created.book.sessions[created.session.token].pending).toBeNull();

    const broken = proposeTrip(
      created.book,
      created.session.token,
      { basedOnRevision: 1, summary: "Bad coordinates.", trip: { ...created.session.accepted, locations: [] } },
      LATER,
      "sug-bad",
    );
    expect(broken.ok).toBe(false);
    expect(created.book.sessions[created.session.token].accepted.name).toMatch(/Bangkok/);
  });

  it("applies only a current suggestion, and a later edit makes an old one stale", () => {
    const created = open();
    const suggested = withNote(created.session.accepted, "Agent note.");
    const proposed = proposeTrip(
      created.book,
      created.session.token,
      { basedOnRevision: 1, summary: "Added a note.", trip: suggested },
      LATER,
      "sug-2",
    );
    if (!proposed.ok) throw new Error("propose");
    const edited = saveAccepted(
      proposed.book,
      created.session.token,
      withNote(created.session.accepted, "I changed this myself."),
      "2026-11-08T12:06:00.000Z",
    );
    expect(edited.ok && edited.session.pending?.stale).toBe(true);
    if (!edited.ok) return;
    const blocked = decideSuggestion(edited.book, created.session.token, "apply", "2026-11-08T12:07:00.000Z");
    expect(blocked.ok).toBe(false);
    expect(edited.session.accepted.stops[2].notes).toMatch(/myself/);

    const fresh = proposeTrip(
      { sessions: { [created.session.token]: { ...edited.session, pending: null } } },
      created.session.token,
      { basedOnRevision: edited.session.revision, summary: "A new note after your edit.", trip: withNote(edited.session.accepted, "Fresh agent note.") },
      "2026-11-08T12:08:00.000Z",
      "sug-3",
    );
    if (!fresh.ok) throw new Error("fresh");
    const applied = decideSuggestion(fresh.book, created.session.token, "apply", "2026-11-08T12:09:00.000Z");
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.session.pending).toBeNull();
    expect(applied.trip.stops[2].notes).toBe("Fresh agent note.");
    expect(applied.session.revision).toBe(edited.session.revision + 1);
  });

  it("dismiss keeps the saved trip and ignores updatedAt-only syncs", () => {
    const created = open();
    const proposed = proposeTrip(
      created.book,
      created.session.token,
      { basedOnRevision: 1, summary: "A detour.", trip: withNote(created.session.accepted, "Detour.") },
      LATER,
      "sug-4",
    );
    if (!proposed.ok) throw new Error("propose");
    const dismissed = decideSuggestion(proposed.book, created.session.token, "dismiss", LATER);
    expect(dismissed.ok).toBe(true);
    if (!dismissed.ok) return;
    expect(dismissed.session.pending).toBeNull();
    expect(samePlan(dismissed.session.accepted, created.session.accepted)).toBe(true);
    const synced = saveAccepted(
      dismissed.book,
      created.session.token,
      { ...dismissed.session.accepted, updatedAt: "2026-11-08T13:00:00.000Z" },
      "2026-11-08T13:00:00.000Z",
    );
    expect(synced.ok && synced.changed).toBe(false);
  });
});
