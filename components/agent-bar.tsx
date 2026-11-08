"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { diffTrips } from "@/lib/agent-diff";
import type { useAgentLink } from "@/components/use-agent-link";
import type { Trip } from "@/lib/types";

type Link = ReturnType<typeof useAgentLink>;

export function AgentBar({
  trip,
  link,
  onApplied,
}: {
  trip: Trip | null;
  link: Link;
  onApplied: (next: Trip, index?: number) => Promise<string[] | null>;
}) {
  const [open, setOpen] = useState(false);
  const [copyNote, setCopyNote] = useState<string | null>(null);
  const changes = trip && link.pending ? diffTrips(trip, link.pending.trip) : [];
  const shown = changes.slice(0, 6);

  async function copyInstructions() {
    if (!link.token || link.revision == null) return;
    const origin = window.location.origin;
    const text = [
      "Waymark agent session",
      `Base URL: ${origin}`,
      `Authorization: Bearer ${link.token}`,
      "",
      "Read the saved trip:",
      `GET ${origin}/api/agent/v1/trip`,
      "",
      "Send a suggestion. This does not replace the saved trip.",
      `PUT ${origin}/api/agent/v1/trip`,
      `Use basedOnRevision ${link.revision}, a short summary, and the full trip.`,
      "If the response is 409, read the trip again and send a new suggestion.",
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopyNote("Copied. Paste it to the bot.");
    } catch {
      setCopyNote("Clipboard is blocked. Select the token and copy it yourself.");
    }
  }

  if (!link.token) {
    return (
      <section className="border-b px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm">
            <span className="font-medium">Review with an agent. </span>
            <span className="text-muted-foreground">Nothing is shared until you open a session.</span>
          </p>
          <Button type="button" size="sm" disabled={!trip || link.busy} onClick={() => void link.start()}>
            {link.busy ? "Opening…" : "Open agent session"}
          </Button>
        </div>
        {link.error ? <p className="mt-1 text-xs text-destructive">{link.error}</p> : null}
      </section>
    );
  }

  return (
    <section className={`border-b px-3 py-2 ${link.pending ? "bg-amber-50" : "bg-card"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={link.pending ? "default" : "secondary"}>{link.pending ? "Suggestion waiting" : "Agent connected"}</Badge>
        <p className="min-w-0 flex-1 text-sm">
          {link.matching
            ? link.pending
              ? link.pending.summary
              : `Revision ${link.revision ?? 1}. The bot can read this trip and send a suggestion.`
            : `This session is for ${link.tripName ?? "another trip"}. Open that trip to review it. This one is not uploaded.`}
        </p>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen((value) => !value)}>
          {open ? "Hide" : "Session"}
        </Button>
      </div>
      {link.pending?.stale ? (
        <p className="mt-1 text-xs text-amber-950">
          You edited the plan after this suggestion. It was not applied. Dismiss it and ask the agent to read the trip again.
        </p>
      ) : null}
      {link.pending && link.matching ? (
        <div className="mt-2 grid gap-2">
          {shown.length > 0 ? (
            <ul className="list-disc pl-4 text-sm">
              {shown.map((change) => (
                <li key={change.id}>{change.text}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm">The suggestion matches the saved trip.</p>
          )}
          {changes.length > shown.length ? (
            <p className="text-xs text-muted-foreground">{changes.length - shown.length} more changes are in the preview.</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant={link.preview ? "default" : "outline"} onClick={() => link.setPreview(!link.preview)}>
              {link.preview ? "Showing suggestion" : "Preview on the map"}
            </Button>
            <Button type="button" size="sm" disabled={link.pending.stale} onClick={() => void link.apply(onApplied)}>
              Apply to this browser
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => void link.dismiss()}>
              Dismiss
            </Button>
          </div>
        </div>
      ) : null}
      {open ? (
        <div className="mt-2 grid gap-2 text-xs text-muted-foreground">
          <p>
            The open trip is copied to this app’s server so the bot can read it. Applying a suggestion is what writes it into this browser. Ending the session deletes the server copy.
          </p>
          <p className="break-all font-mono">Bearer {link.token}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => void copyInstructions()}>
              Copy instructions
            </Button>
            {copyNote ? <span>{copyNote}</span> : null}
            <Button type="button" size="sm" variant="ghost" onClick={() => void link.stop()}>
              End session
            </Button>
          </div>
        </div>
      ) : null}
      {link.error ? <p className="mt-1 text-xs text-destructive">{link.error}</p> : null}
    </section>
  );
}
