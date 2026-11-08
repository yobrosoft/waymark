import { randomBytes } from "node:crypto";
import { integrityIssues, tripSchema, zodIssues } from "@/lib/schema";
import type { Trip } from "@/lib/types";

export const AGENT_INSTRUCTIONS =
  "GET returns the saved trip and its revision. PUT a suggestion with basedOnRevision set to that revision, a short summary, and the full trip. The saved trip is not replaced until the person applies the suggestion in Waymark. A 409 means the saved trip changed; read it again and send a new suggestion.";

export interface AgentSuggestion {
  id: string;
  summary: string;
  trip: Trip;
  basedOnRevision: number;
  createdAt: string;
  stale: boolean;
}

export interface AgentSession {
  token: string;
  tripId: string;
  revision: number;
  accepted: Trip;
  pending: AgentSuggestion | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionBook {
  sessions: Record<string, AgentSession>;
}

export function emptyBook(): SessionBook {
  return { sessions: {} };
}

export function newAgentToken(): string {
  return randomBytes(24).toString("base64url");
}

export function samePlan(a: Trip, b: Trip): boolean {
  const rest = (trip: Trip) =>
    JSON.stringify({
      schemaVersion: trip.schemaVersion,
      id: trip.id,
      name: trip.name,
      summary: trip.summary,
      timezone: trip.timezone,
      status: trip.status,
      days: trip.days,
      locations: trip.locations,
      stops: trip.stops,
      legModes: trip.legModes,
      createdAt: trip.createdAt,
    });
  return rest(a) === rest(b);
}

function checkedTrip(input: unknown): { ok: true; trip: Trip } | { ok: false; error: string; issues: string[] } {
  const parsed = tripSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "The trip did not match version 1. Nothing was stored.", issues: zodIssues(parsed.error) };
  }
  const issues = integrityIssues(parsed.data);
  if (issues.length) return { ok: false, error: "The trip has broken links. Nothing was stored.", issues };
  return { ok: true, trip: { ...parsed.data, kind: undefined, exportedAt: undefined } };
}

export function createSession(
  book: SessionBook,
  input: unknown,
  now: string,
  token = newAgentToken(),
): { ok: true; book: SessionBook; session: AgentSession } | { ok: false; error: string; issues?: string[] } {
  const checked = checkedTrip(input);
  if (!checked.ok) return checked;
  const session: AgentSession = {
    token,
    tripId: checked.trip.id,
    revision: 1,
    accepted: checked.trip,
    pending: null,
    createdAt: now,
    updatedAt: now,
  };
  return { ok: true, session, book: { sessions: { ...book.sessions, [token]: session } } };
}

export function getSession(book: SessionBook, token: string): AgentSession | null {
  return book.sessions[token] ?? null;
}

export function endSession(book: SessionBook, token: string): SessionBook {
  const sessions = { ...book.sessions };
  delete sessions[token];
  return { sessions };
}

export function saveAccepted(
  book: SessionBook,
  token: string,
  input: unknown,
  now: string,
): { ok: true; book: SessionBook; session: AgentSession; changed: boolean } | { ok: false; status: number; error: string; issues?: string[] } {
  const current = book.sessions[token];
  if (!current) return { ok: false, status: 404, error: "This agent session was not found. It may have been ended." };
  const checked = checkedTrip(input);
  if (!checked.ok) return { ok: false, status: 400, error: checked.error, issues: checked.issues };
  if (checked.trip.id !== current.tripId) {
    return { ok: false, status: 409, error: "That trip id does not belong to this session. The saved trip was not changed." };
  }
  if (samePlan(current.accepted, checked.trip)) {
    return { ok: true, book, session: current, changed: false };
  }
  const session: AgentSession = {
    ...current,
    revision: current.revision + 1,
    accepted: checked.trip,
    pending: current.pending ? { ...current.pending, stale: true } : null,
    updatedAt: now,
  };
  return { ok: true, changed: true, session, book: { sessions: { ...book.sessions, [token]: session } } };
}

export function proposeTrip(
  book: SessionBook,
  token: string,
  input: unknown,
  now: string,
  suggestionId: string,
): { ok: true; book: SessionBook; session: AgentSession; replaced: boolean } | { ok: false; status: number; error: string; issues?: string[]; revision?: number; trip?: Trip } {
  const current = book.sessions[token];
  if (!current) return { ok: false, status: 404, error: "This agent session was not found. It may have been ended." };
  const record = input && typeof input === "object" ? (input as Record<string, unknown>) : null;
  if (!record) return { ok: false, status: 400, error: "Send a JSON object with basedOnRevision, summary, and trip." };
  if (record.basedOnRevision !== current.revision) {
    return {
      ok: false,
      status: 409,
      error: "The saved trip has a newer revision. Read it again and send a new suggestion. Nothing was replaced.",
      revision: current.revision,
      trip: current.accepted,
    };
  }
  const summary = typeof record.summary === "string" ? record.summary.trim() : "";
  if (summary.length < 3 || summary.length > 500) {
    return { ok: false, status: 400, error: "Add a summary of the change, between 3 and 500 characters. Nothing was stored." };
  }
  const checked = checkedTrip(record.trip);
  if (!checked.ok) return { ok: false, status: 400, error: checked.error, issues: checked.issues };
  if (checked.trip.id !== current.tripId) {
    return {
      ok: false,
      status: 409,
      error: "Keep the same trip id. A suggestion with a different id was not stored.",
    };
  }
  const replaced = current.pending != null;
  const session: AgentSession = {
    ...current,
    pending: {
      id: suggestionId,
      summary,
      trip: checked.trip,
      basedOnRevision: current.revision,
      createdAt: now,
      stale: false,
    },
    updatedAt: now,
  };
  return { ok: true, replaced, session, book: { sessions: { ...book.sessions, [token]: session } } };
}

export function decideSuggestion(
  book: SessionBook,
  token: string,
  action: "apply" | "dismiss",
  now: string,
): { ok: true; book: SessionBook; session: AgentSession; trip: Trip } | { ok: false; status: number; error: string } {
  const current = book.sessions[token];
  if (!current) return { ok: false, status: 404, error: "This agent session was not found." };
  if (action === "dismiss") {
    const session = { ...current, pending: null, updatedAt: now };
    return { ok: true, session, trip: session.accepted, book: { sessions: { ...book.sessions, [token]: session } } };
  }
  if (!current.pending) return { ok: false, status: 404, error: "There is no suggestion to apply." };
  if (current.pending.stale) {
    return {
      ok: false,
      status: 409,
      error: "This suggestion was based on an older version. It was not applied. Dismiss it and ask the agent to send a new one.",
    };
  }
  const session: AgentSession = {
    ...current,
    revision: current.revision + 1,
    accepted: current.pending.trip,
    pending: null,
    updatedAt: now,
  };
  return { ok: true, session, trip: session.accepted, book: { sessions: { ...book.sessions, [token]: session } } };
}
