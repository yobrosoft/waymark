import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createSession,
  decideSuggestion,
  emptyBook,
  endSession,
  proposeTrip,
  saveAccepted,
  type AgentSession,
  type AgentSuggestion,
  type SessionBook,
} from "@/lib/agent-session";
import type { Trip } from "@/lib/types";

export interface TripSummary {
  tripId: string;
  name: string;
  revision: number;
  updatedAt: string;
  pendingSummary: string | null;
  pendingStale: boolean;
}

export interface Store {
  share(trip: unknown, now?: string): Promise<ShareResult>;
  read(tripId: string): Promise<AgentSession | null>;
  list(): Promise<TripSummary[]>;
  propose(tripId: string, input: unknown, now?: string): Promise<ProposeResult>;
  decide(tripId: string, action: "apply" | "dismiss", now?: string): Promise<DecideResult>;
  end(tripId: string): Promise<void>;
}

type ShareResult =
  | { ok: true; revision: number; tripId: string; pending: AgentSuggestion | null; changed: boolean }
  | { ok: false; status: number; error: string; issues?: string[] };

type ProposeResult =
  | { ok: true; revision: number; replaced: boolean; summary: string }
  | { ok: false; status: number; error: string; issues?: string[]; revision?: number; trip?: Trip };

type DecideResult =
  | { ok: true; revision: number; trip: Trip; pending: AgentSuggestion | null }
  | { ok: false; status: number; error: string };

export function createStore(filePath: string, proposalIntervalMs = 1000): Store {
  let book: SessionBook = emptyBook();
  let chain: Promise<unknown> = Promise.resolve();
  const lastProposal = new Map<string, number>();

  function exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = chain.then(task, task);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function ready(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(filePath, "utf8")) as SessionBook;
      book = parsed?.sessions ? parsed : emptyBook();
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        book = emptyBook();
        return;
      }
      throw new Error("session file could not be read");
    }
  }

  async function persist(): Promise<void> {
    const dir = path.dirname(filePath);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700);
    const temp = `${filePath}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(book), { mode: 0o600 });
    await chmod(temp, 0o600);
    await rename(temp, filePath);
    await chmod(filePath, 0o600);
  }

  return {
    share(trip, now = new Date().toISOString()) {
      return exclusive(async () => {
        await ready();
        const id = trip && typeof trip === "object" ? (trip as { id?: unknown }).id : undefined;
        const tripId = typeof id === "string" ? id : "";
        const current = tripId ? book.sessions[tripId] : undefined;
        if (current) {
          const saved = saveAccepted(book, tripId, trip, now);
          if (!saved.ok) return saved;
          book = saved.book;
          if (saved.changed) await persist();
          return {
            ok: true as const,
            revision: saved.session.revision,
            tripId,
            pending: saved.session.pending,
            changed: saved.changed,
          };
        }
        const created = createSession(book, trip, now, tripId || undefined);
        if (!created.ok) return { ok: false as const, status: 400, error: created.error, issues: created.issues };
        book = created.book;
        await persist();
        return {
          ok: true as const,
          revision: created.session.revision,
          tripId: created.session.tripId,
          pending: null,
          changed: true,
        };
      });
    },
    read(tripId) {
      return exclusive(async () => {
        await ready();
        return book.sessions[tripId] ?? null;
      });
    },
    list() {
      return exclusive(async () => {
        await ready();
        return Object.values(book.sessions)
          .map(summary)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      });
    },
    propose(tripId, input, now = new Date().toISOString()) {
      const previous = lastProposal.get(tripId) ?? 0;
      if (Date.now() - previous < proposalIntervalMs) {
        return Promise.resolve({
          ok: false as const,
          status: 429,
          error: "Wait a second before sending another suggestion. The previous one was not replaced.",
        });
      }
      return exclusive(async () => {
        await ready();
        const result = proposeTrip(book, tripId, input, now, `sug-${randomBytes(8).toString("hex")}`);
        if (!result.ok) return result;
        book = result.book;
        lastProposal.set(tripId, Date.now());
        await persist();
        return {
          ok: true as const,
          revision: result.session.revision,
          replaced: result.replaced,
          summary: result.session.pending?.summary ?? "",
        };
      });
    },
    decide(tripId, action, now = new Date().toISOString()) {
      return exclusive(async () => {
        await ready();
        const result = decideSuggestion(book, tripId, action, now);
        if (!result.ok) return result;
        book = result.book;
        await persist();
        return { ok: true as const, revision: result.session.revision, trip: result.trip, pending: result.session.pending };
      });
    },
    end(tripId) {
      return exclusive(async () => {
        await ready();
        if (!book.sessions[tripId]) return;
        book = endSession(book, tripId);
        lastProposal.delete(tripId);
        await persist();
      });
    },
  };
}

function summary(session: AgentSession): TripSummary {
  return {
    tripId: session.tripId,
    name: session.accepted.name,
    revision: session.revision,
    updatedAt: session.updatedAt,
    pendingSummary: session.pending?.summary ?? null,
    pendingStale: session.pending?.stale ?? false,
  };
}
