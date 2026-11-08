"use client";

import { useEffect, useState } from "react";
import type { AgentSuggestion } from "@/lib/agent-session";
import type { Trip } from "@/lib/types";

const TOKEN_KEY = "waymark-agent-token";

export function useAgentLink(trip: Trip | null) {
  const [token, setToken] = useState<string | null>(null);
  const [revision, setRevision] = useState<number | null>(null);
  const [tripId, setTripId] = useState<string | null>(null);
  const [tripName, setTripName] = useState<string | null>(null);
  const [pending, setPending] = useState<AgentSuggestion | null>(null);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const saved = window.sessionStorage.getItem(TOKEN_KEY);
    if (saved) setToken(saved);
  }, []);

  useEffect(() => {
    if (!token) return;
    let stop = false;
    const pull = async () => {
      try {
        const response = await fetch("/api/agent/session", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (stop) return;
        if (response.status === 404) {
          window.sessionStorage.removeItem(TOKEN_KEY);
          setToken(null);
          setPending(null);
          setPreview(false);
          setError("The agent session ended. The trip saved in this browser was not changed.");
          return;
        }
        const body = (await response.json()) as {
          ok?: boolean;
          revision?: number;
          tripId?: string;
          tripName?: string;
          pending?: AgentSuggestion | null;
        };
        if (!response.ok || !body.ok) return;
        setRevision(body.revision ?? null);
        setTripId(body.tripId ?? null);
        setTripName(body.tripName ?? null);
        setPending(body.pending ?? null);
        if (!body.pending) setPreview(false);
      } catch {
        setError("Could not reach the agent session. Your saved trip was not changed.");
      }
    };
    void pull();
    const id = window.setInterval(() => void pull(), 3000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [token]);

  useEffect(() => {
    if (!token || !trip || !tripId || trip.id !== tripId) return;
    const handle = window.setTimeout(() => {
      void fetch("/api/agent/session", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ trip }),
      })
        .then(async (response) => {
          if (!response.ok) return;
          const body = (await response.json()) as { revision?: number; pending?: AgentSuggestion | null };
          if (typeof body.revision === "number") setRevision(body.revision);
          if (body.pending !== undefined) setPending(body.pending);
        })
        .catch(() => undefined);
    }, 400);
    return () => window.clearTimeout(handle);
  }, [token, tripId, trip]);

  async function start() {
    if (!trip) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/agent/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trip }),
      });
      const body = (await response.json()) as { ok?: boolean; error?: string; token?: string; revision?: number; tripId?: string };
      if (!response.ok || !body.token) {
        setError(body.error ?? "Could not open a session.");
        return;
      }
      window.sessionStorage.setItem(TOKEN_KEY, body.token);
      setToken(body.token);
      setRevision(body.revision ?? 1);
      setTripId(body.tripId ?? trip.id);
      setTripName(trip.name);
    } catch {
      setError("Could not open a session. The trip stayed in this browser only.");
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    if (!token) return;
    await fetch("/api/agent/session", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => undefined);
    window.sessionStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setPending(null);
    setPreview(false);
    setTripId(null);
    setRevision(null);
  }

  async function dismiss() {
    if (!token) return;
    const response = await fetch("/api/agent/session/decision", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "dismiss" }),
    });
    if (response.ok) {
      setPending(null);
      setPreview(false);
      setError(null);
    }
  }

  async function apply(commit: (next: Trip, index?: number) => Promise<string[] | null>) {
    if (!token || !pending) return;
    if (pending.stale) {
      setError("This suggestion is older than your latest edits. Dismiss it and ask the agent for a new one.");
      return;
    }
    const response = await fetch("/api/agent/session/decision", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "apply" }),
    });
    const body = (await response.json()) as { ok?: boolean; error?: string; trip?: Trip; revision?: number };
    if (!response.ok || !body.trip) {
      setError(body.error ?? "The suggestion was not applied.");
      return;
    }
    const issues = await commit(body.trip, 0);
    if (issues?.length) {
      setError(issues[0]);
      return;
    }
    setPending(null);
    setPreview(false);
    setRevision(body.revision ?? null);
    setError(null);
  }

  const matching = Boolean(trip && tripId && trip.id === tripId);
  const activePending = matching ? pending : null;

  return {
    token,
    revision,
    tripId,
    tripName,
    pending: activePending,
    preview: preview && Boolean(activePending),
    setPreview,
    error,
    clearError: () => setError(null),
    busy,
    matching,
    start,
    stop,
    dismiss,
    apply,
  };
}
