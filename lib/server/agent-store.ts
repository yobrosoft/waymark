import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  createSession,
  decideSuggestion,
  emptyBook,
  endSession,
  getSession,
  proposeTrip,
  saveAccepted,
  type SessionBook,
} from "@/lib/agent-session";

const filePath = path.join(process.cwd(), "data", "agent-sessions.json");

let book: SessionBook = emptyBook();
let loaded = false;
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
  if (loaded) return;
  try {
    book = JSON.parse(await readFile(filePath, "utf8")) as SessionBook;
    if (!book.sessions) book = emptyBook();
  } catch {
    book = emptyBook();
  }
  loaded = true;
}

async function persist(): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(book));
}

export async function openAgentSession(trip: unknown, now = new Date().toISOString()) {
  return exclusive(async () => {
    await ready();
    const result = createSession(book, trip, now);
    if (!result.ok) return result;
    book = result.book;
    await persist();
    return { ok: true as const, token: result.session.token, revision: result.session.revision, tripId: result.session.tripId };
  });
}

export async function readAgentSession(token: string) {
  return exclusive(async () => {
    await ready();
    return getSession(book, token);
  });
}

export async function closeAgentSession(token: string) {
  return exclusive(async () => {
    await ready();
    book = endSession(book, token);
    lastProposal.delete(token);
    await persist();
  });
}

export async function syncAgentSession(token: string, trip: unknown, now = new Date().toISOString()) {
  return exclusive(async () => {
    await ready();
    const result = saveAccepted(book, token, trip, now);
    if (!result.ok) return result;
    book = result.book;
    if (result.changed) await persist();
    return { ok: true as const, revision: result.session.revision, pending: result.session.pending, changed: result.changed };
  });
}

export async function proposeAgentTrip(token: string, input: unknown, now = new Date().toISOString()) {
  const previous = lastProposal.get(token) ?? 0;
  if (Date.now() - previous < 1000) {
    return {
      ok: false as const,
      status: 429,
      error: "Wait a second before sending another suggestion. The previous one was not replaced.",
    };
  }
  return exclusive(async () => {
    await ready();
    const result = proposeTrip(book, token, input, now, `sug-${randomBytes(8).toString("hex")}`);
    if (!result.ok) return result;
    book = result.book;
    lastProposal.set(token, Date.now());
    await persist();
    return {
      ok: true as const,
      revision: result.session.revision,
      replaced: result.replaced,
      summary: result.session.pending?.summary ?? "",
    };
  });
}

export async function decideAgentSuggestion(token: string, action: "apply" | "dismiss", now = new Date().toISOString()) {
  return exclusive(async () => {
    await ready();
    const result = decideSuggestion(book, token, action, now);
    if (!result.ok) return result;
    book = result.book;
    await persist();
    return { ok: true as const, revision: result.session.revision, trip: result.trip, pending: result.session.pending };
  });
}
