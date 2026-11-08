"use client";

import { useEffect, useRef, useState } from "react";
import { samePlan } from "@/lib/agent-diff";
import type { AgentSuggestion } from "@/lib/agent-session";
import type { Trip } from "@/lib/types";

export interface SharedTrip {
  tripId: string;
  name: string;
  revision: number;
  updatedAt: string;
  pendingSummary: string | null;
  pendingStale: boolean;
}

const BASE = (process.env.NEXT_PUBLIC_WAYMARK_AGENT_URL ?? "").replace(/\/$/, "");

export function useAgentLink(trip: Trip | null) {
  const [revision, setRevision] = useState<number | null>(null);
  const [pending, setPending] = useState<AgentSuggestion | null>(null);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [holding, setHolding] = useState<"off" | "local" | "remote">("off");
  const [remoteTrip, setRemoteTrip] = useState<Trip | null>(null);
  const [shared, setShared] = useState<SharedTrip[]>([]);
  const seenRevision = useRef<number | null>(null);

  useEffect(() => {
    if (!BASE) return;
    let stop = false;
    const pullList = async () => {
      try {
        const response = await fetch(`${BASE}/api/agent/trips`);
        if (stop || !response.ok) return;
        const body = (await response.json()) as { trips?: SharedTrip[] };
        setShared(body.trips ?? []);
        setError((current) => (current?.startsWith("Could not reach") ? null : current));
      } catch {
        if (!stop) setError("Could not reach Waymark on this Mac. The trip in this browser was not changed.");
      }
    };
    void pullList();
    const id = window.setInterval(() => void pullList(), 3000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!BASE || !trip) return;
    let stop = false;
    const pull = async () => {
      try {
        const response = await fetch(`${BASE}/api/agent/trips/${encodeURIComponent(trip.id)}`);
        if (stop) return;
        const body = (await response.json()) as {
          ok?: boolean;
          shared?: boolean;
          revision?: number;
          trip?: Trip;
          pending?: AgentSuggestion | null;
        };
        if (!response.ok || !body.ok) return;
        if (body.shared === false || !body.trip || typeof body.revision !== "number") {
          seenRevision.current = null;
          setHolding("off");
          setRemoteTrip(null);
          setPending(null);
          setPreview(false);
          setRevision(null);
          return;
        }
        setRevision(body.revision);
        setPending(body.pending ?? null);
        if (!body.pending) setPreview(false);
        if (samePlan(trip, body.trip)) {
          seenRevision.current = body.revision;
          setRemoteTrip(null);
          setHolding("local");
        } else if (seenRevision.current == null || body.revision > seenRevision.current) {
          seenRevision.current = body.revision;
          setRemoteTrip(body.trip);
          setHolding("remote");
        } else {
          setHolding("local");
        }
      } catch {
        if (!stop) setError("Could not reach Waymark on this Mac. The trip in this browser was not changed.");
      }
    };
    void pull();
    const id = window.setInterval(() => void pull(), 3000);
    return () => {
      stop = true;
      window.clearInterval(id);
    };
  }, [trip]);

  useEffect(() => {
    if (!BASE || holding !== "local" || !trip) return;
    const handle = window.setTimeout(() => {
      void fetch(`${BASE}/api/agent/trips/${encodeURIComponent(trip.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trip }),
      })
        .then(async (response) => {
          if (!response.ok) return;
          const body = (await response.json()) as { revision?: number; pending?: AgentSuggestion | null };
          if (typeof body.revision === "number") {
            seenRevision.current = body.revision;
            setRevision(body.revision);
          }
          if (body.pending !== undefined) setPending(body.pending);
        })
        .catch(() => undefined);
    }, 400);
    return () => window.clearTimeout(handle);
  }, [holding, trip]);

  async function start() {
    if (!trip) return;
    if (!BASE) {
      setError("This app does not know the Waymark address on your tailnet yet.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${BASE}/api/agent/trips/${encodeURIComponent(trip.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trip }),
      });
      const body = (await response.json()) as { ok?: boolean; error?: string; revision?: number; pending?: AgentSuggestion | null };
      if (!response.ok || !body.ok) {
        setError(body.error ?? "Could not share this trip.");
        return;
      }
      seenRevision.current = body.revision ?? 1;
      setHolding("local");
      setRemoteTrip(null);
      setRevision(body.revision ?? 1);
      setPending(body.pending ?? null);
    } catch {
      setError("Could not share this trip. It stayed in this browser only.");
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    if (!BASE || !trip) return;
    await fetch(`${BASE}/api/agent/trips/${encodeURIComponent(trip.id)}`, { method: "DELETE" }).catch(() => undefined);
    seenRevision.current = null;
    setHolding("off");
    setPending(null);
    setPreview(false);
    setRemoteTrip(null);
    setRevision(null);
  }

  async function dismiss() {
    if (!BASE || !trip) return;
    const response = await fetch(`${BASE}/api/agent/trips/${encodeURIComponent(trip.id)}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "dismiss" }),
    });
    if (response.ok) {
      setPending(null);
      setPreview(false);
      setError(null);
    }
  }

  async function apply(commit: (next: Trip, index?: number) => Promise<string[] | null>) {
    if (!BASE || !trip || !pending) return;
    if (pending.stale) {
      setError("This suggestion is older than the saved trip. Dismiss it and ask Grok for a new one.");
      return;
    }
    const response = await fetch(`${BASE}/api/agent/trips/${encodeURIComponent(trip.id)}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
    setRemoteTrip(null);
    setHolding("local");
    setRevision(body.revision ?? null);
    setError(null);
  }

  async function fetchTrip(tripId: string): Promise<Trip | null> {
    if (!BASE) return null;
    const response = await fetch(`${BASE}/api/agent/trips/${encodeURIComponent(tripId)}`);
    if (!response.ok) return null;
    const body = (await response.json()) as { trip?: Trip };
    return body.trip ?? null;
  }

  const sharing = holding !== "off";

  return {
    configured: Boolean(BASE),
    revision,
    pending: sharing ? pending : null,
    preview: preview && sharing && Boolean(pending),
    setPreview,
    error,
    clearError: () => setError(null),
    busy,
    sharing,
    remoteTrip,
    shared,
    start,
    stop,
    dismiss,
    apply,
    fetchTrip,
  };
}
