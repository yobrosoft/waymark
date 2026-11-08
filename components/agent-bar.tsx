"use client";

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
  onOpenShared,
}: {
  trip: Trip | null;
  link: Link;
  onApplied: (next: Trip, index?: number) => Promise<string[] | null>;
  onOpenShared: (tripId: string) => Promise<void>;
}) {
  const changes = trip && link.pending ? diffTrips(trip, link.pending.trip) : [];
  const shown = changes.slice(0, 6);
  const others = link.shared.filter((item) => item.tripId !== trip?.id);

  if (!link.configured) {
    return (
      <section className="border-b px-3 py-2 text-sm text-muted-foreground">
        Sharing with Grok is off until this app knows the Waymark address on your tailnet.
      </section>
    );
  }

  return (
    <section className={`border-b px-3 py-2 ${link.pending || link.remoteTrip ? "bg-amber-50" : "bg-card"}`}>
      {!trip ? (
        <div className="grid gap-2">
          <p className="text-sm text-muted-foreground">No trip is open in this browser. Shared trips stay on this Mac.</p>
          {others.length > 0 ? <SharedList trips={others} onOpen={onOpenShared} /> : null}
        </div>
      ) : link.remoteTrip ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge>Newer plan on this Mac</Badge>
          <p className="min-w-0 flex-1 text-sm">This browser’s copy is behind the plan stored for Grok. Loading it does not upload anything new.</p>
          <Button type="button" size="sm" onClick={() => void onApplied(link.remoteTrip as Trip, 0)}>
            Load it here
          </Button>
        </div>
      ) : !link.sharing ? (
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm">
              <span className="font-medium">Share with Grok. </span>
              <span className="text-muted-foreground">Nothing is copied to this Mac until you share. A suggestion waits here until you apply it.</span>
            </p>
            <Button type="button" size="sm" disabled={link.busy} onClick={() => void link.start()}>
              {link.busy ? "Sharing…" : "Share this trip"}
            </Button>
          </div>
          {others.length > 0 ? <SharedList trips={others} onOpen={onOpenShared} /> : null}
        </div>
      ) : (
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={link.pending ? "default" : "secondary"}>{link.pending ? "Suggestion waiting" : "Shared with Grok"}</Badge>
            <p className="min-w-0 flex-1 text-sm">
              {link.pending
                ? link.pending.summary
                : `Revision ${link.revision ?? 1}. Grok can read this trip and send a suggestion. It shows up on this computer and on your phone.`}
            </p>
            <Button type="button" size="sm" variant="ghost" onClick={() => void link.stop()}>
              Stop sharing
            </Button>
          </div>
          {link.pending?.stale ? (
            <p className="text-xs text-amber-950">You edited the plan after this suggestion. It was not applied. Dismiss it and ask Grok to read the trip again.</p>
          ) : null}
          {link.pending ? (
            <div className="grid gap-2">
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
          {others.length > 0 ? <SharedList trips={others} onOpen={onOpenShared} /> : null}
        </div>
      )}
      {link.error ? <p className="mt-1 text-xs text-destructive">{link.error}</p> : null}
    </section>
  );
}

function SharedList({
  trips,
  onOpen,
}: {
  trips: Link["shared"];
  onOpen: (tripId: string) => Promise<void>;
}) {
  return (
    <ul className="grid gap-1">
      {trips.map((item) => (
        <li key={item.tripId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            {item.name}
            {item.pendingSummary ? ` · ${item.pendingSummary}` : ""}
          </span>
          <Button type="button" size="sm" variant="outline" onClick={() => void onOpen(item.tripId)}>
            Open here
          </Button>
        </li>
      ))}
    </ul>
  );
}
