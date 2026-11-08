"use client";

import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { downloadJson } from "@/components/download";
import { createId, slugify } from "@/lib/ids";
import { libraryDocument, parseImport, type ImportCommit } from "@/lib/library";
import { FIX_THE_MAP_URL, OSM_COPYRIGHT_URL } from "@/lib/providers";
import { integrityIssues, isRealDate, isValidTimeZone, tripSchema, zodIssues } from "@/lib/schema";
import { applyStopDraft, locationUseCount, type StopDraft } from "@/lib/trip-logic";
import type { Library, Stop, Trip } from "@/lib/types";
import { TRIP_STATUS_LABEL } from "@/lib/format";

export function ConfirmDelete({
  open,
  title,
  body,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  title: string;
  body: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function HelpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="waymark-dialog max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>How this trip book works</DialogTitle>
          <DialogDescription>
            Waymark plans one leg at a time on a real street map. Your trips stay in this browser.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 text-sm leading-relaxed">
          <section>
            <h3 className="font-heading text-base font-medium">Saved on this device</h3>
            <p className="mt-1 text-muted-foreground">
              Trips are stored in IndexedDB in this browser profile. They are not synced to an account
              and this site does not upload them. Another phone, another browser, or a cleared
              site-storage setting will not have them. Export a JSON backup when a trip matters.
              Reloading the page does not replace your edits with the sample.
            </p>
          </section>
          <section>
            <h3 className="font-heading text-base font-medium">What leaves the browser</h3>
            <p className="mt-1 text-muted-foreground">
              The map asks Google for the streets, restaurants, landmarks, and other places in the
              current view. A selected drive, walk, or cycle leg sends those two coordinates from this
              browser to the FOSSGIS OSRM demo (routing.openstreetmap.de). A nearby-category search
              sends the pin and a 700 metre query to a public Overpass server, which often refuses or
              times out; the list then stays empty and says so. Address search is off because the public
              geocoder refuses browser requests. Names, notes, and the rest of the library are not part
              of those requests. The Google Maps key stays in this browser, or in the build if one was
              set there. Sharing a trip copies that trip to the Waymark server on this Mac so Grok can
              read it and send a suggestion. The suggestion is not written here until you apply it.
              Stop sharing deletes that server copy. Other trips stay in this browser.
            </p>
          </section>
          <section>
            <h3 className="font-heading text-base font-medium">Routes are not guesses</h3>
            <p className="mt-1 text-muted-foreground">
              Distance and time appear only when OSRM returns a road route. The time is a typical
              uncongested estimate, not live traffic. The graphs are rebuilt about every two days.
              Walking and cycling use the foot and bike profiles. Transit, taxi, and rideshare times are
              not invented; those links open Google Maps, and any time you see there is Google&apos;s.
              If the routing service fails, the line stays off and the numbers stay blank.
              Same-place rest stops do not request a route. Ferry avoidance is not guaranteed on the
              OSRM profile. The Google driving link asks Google to avoid ferries.
            </p>
          </section>
          <section>
            <h3 className="font-heading text-base font-medium">Pins and the sample trip</h3>
            <p className="mt-1 text-muted-foreground">
              Pins are venue, complex, or facility points. They are not a promise of a step-free
              entrance or an exact curb. The Bangkok 8–14 December 2026 trip is a proposed sequence,
              not a booking. Nothing else is preloaded. Add another trip yourself, or import one.
            </p>
          </section>
          <section>
            <h3 className="font-heading text-base font-medium">Limits</h3>
            <p className="mt-1 text-muted-foreground">
              Public routing is limited to about one request per second, and nearby search is slower.
              Results are cached in this browser. Do not bulk-export routes. Map places © Google. Routes
              via OSRM / FOSSGIS, using OpenStreetMap.
            </p>
            <p className="mt-2">
              <a className="underline" href={OSM_COPYRIGHT_URL} target="_blank" rel="noreferrer">
                OpenStreetMap copyright
              </a>
              {" · "}
              <a className="underline" href={FIX_THE_MAP_URL} target="_blank" rel="noreferrer">
                Fix the map
              </a>
            </p>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function LibraryDialog({
  open,
  onOpenChange,
  library,
  onOpenTrip,
  onDuplicate,
  onDelete,
  onCreate,
  onImport,
  onAddSample,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  library: Library;
  onOpenTrip: (id: string) => void;
  onDuplicate: () => void;
  onDelete: (id: string) => void;
  onCreate: (input: { name: string; timezone: string }) => Promise<string | null>;
  onImport: (trips: Trip[], mode: ImportCommit) => Promise<string | null>;
  onAddSample: () => Promise<string | null>;
}) {
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("Asia/Bangkok");
  const [message, setMessage] = useState<string | null>(null);
  const [importTrips, setImportTrips] = useState<Trip[] | null>(null);
  const [importNotes, setImportNotes] = useState<string[]>([]);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  async function readFile(file: File) {
    setMessage(null);
    setImportTrips(null);
    const text = await file.text();
    const parsed = parseImport(text);
    if (!parsed.ok) {
      setImportNotes(parsed.issues);
      return;
    }
    setImportTrips(parsed.trips);
    setImportNotes(parsed.warnings);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="waymark-dialog max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Trip library</DialogTitle>
          <DialogDescription>
            {library.trips.length} saved in this browser. Nothing here is uploaded.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {library.trips.length === 0 ? (
            <p className="rounded-lg bg-muted px-3 py-4 text-sm text-muted-foreground">
              No trips yet. Start a new one, import a backup, or add the sample Bangkok trip.
            </p>
          ) : (
            library.trips.map((item) => (
              <article key={item.id} className="rounded-xl border bg-card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-heading text-base font-medium">{item.name}</h3>
                    <p className="text-xs text-muted-foreground">
                      {item.stops.length} stops · {item.days.length} days · {TRIP_STATUS_LABEL[item.status]}
                      {item.id === library.activeTripId ? " · Open now" : ""}
                    </p>
                  </div>
                  <Badge variant={item.status === "confirmed" ? "default" : "secondary"}>
                    {TRIP_STATUS_LABEL[item.status]}
                  </Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" size="sm" onClick={() => onOpenTrip(item.id)} disabled={item.id === library.activeTripId}>
                    Open
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => downloadJson(`waymark-${slugify(item.name)}.json`, { ...item, kind: "waymark.trip", exportedAt: new Date().toISOString() })}
                  >
                    Export
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={onDuplicate} disabled={item.id !== library.activeTripId}>
                    Duplicate
                  </Button>
                  <Button type="button" size="sm" variant="destructive" onClick={() => setPendingDelete(item.id)}>
                    Delete
                  </Button>
                </div>
              </article>
            ))
          )}
        </div>
        <div className="grid gap-3 rounded-xl border p-3">
          <h3 className="font-medium">New trip</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <Label className="grid gap-1">
              Name
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Taipei, March" />
            </Label>
            <Label className="grid gap-1">
              Time zone
              <Input value={timezone} onChange={(event) => setTimezone(event.target.value)} list="waymark-zones" />
              <datalist id="waymark-zones">
                <option value="Asia/Bangkok" />
                <option value="Asia/Taipei" />
                <option value="Asia/Kuala_Lumpur" />
                <option value="Asia/Singapore" />
              </datalist>
            </Label>
          </div>
          <Button
            type="button"
            onClick={async () => {
              const error = await onCreate({ name, timezone });
              setMessage(error);
              if (!error) {
                setName("");
                onOpenChange(false);
              }
            }}
          >
            Create empty trip
          </Button>
        </div>
        <div className="grid gap-2 rounded-xl border p-3">
          <h3 className="font-medium">Import JSON</h3>
          <Input
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void readFile(file);
            }}
          />
          {importNotes.length > 0 && !importTrips ? (
            <ul className="list-disc pl-5 text-sm text-destructive">
              {importNotes.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}
          {importTrips ? (
            <div className="grid gap-2 text-sm">
              <p>
                {importTrips.length} trip{importTrips.length === 1 ? "" : "s"},{" "}
                {importTrips.reduce((sum, item) => sum + item.stops.length, 0)} stops. Nothing is written until you choose.
              </p>
              {importNotes.map((note) => (
                <p key={note} className="text-muted-foreground">{note}</p>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  onClick={async () => {
                    const error = await onImport(importTrips, "copy");
                    setMessage(error);
                    if (!error) {
                      setImportTrips(null);
                      onOpenChange(false);
                    }
                  }}
                >
                  Add as new trips
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    const error = await onImport(importTrips, "replace");
                    setMessage(error);
                    if (!error) {
                      setImportTrips(null);
                      onOpenChange(false);
                    }
                  }}
                >
                  Replace trips with the same id
                </Button>
              </div>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => downloadJson(`waymark-library-${new Date().toISOString().slice(0, 10)}.json`, libraryDocument(library, new Date().toISOString()))}
            >
              Export all
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                const error = await onAddSample();
                setMessage(error);
                if (!error) onOpenChange(false);
              }}
            >
              Add sample Bangkok trip
            </Button>
          </div>
        </div>
        {message ? <p className="text-sm text-destructive">{message}</p> : null}
        <ConfirmDelete
          open={pendingDelete != null}
          onOpenChange={(next) => {
            if (!next) setPendingDelete(null);
          }}
          title="Delete this trip from this browser?"
          body="There is no cloud copy. Export it first if you might want it again. This cannot be undone."
          onConfirm={() => {
            if (pendingDelete) onDelete(pendingDelete);
            setPendingDelete(null);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

export function TripEditor({
  open,
  trip,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  trip: Trip;
  onOpenChange: (open: boolean) => void;
  onSave: (trip: Trip) => Promise<string[] | null>;
}) {
  const [draft, setDraft] = useState(trip);
  const [issues, setIssues] = useState<string[]>([]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="waymark-dialog max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit trip</DialogTitle>
          <DialogDescription>Dates, name, and status. Stop order stays in the list.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={async (event) => {
            event.preventDefault();
            const parsed = tripSchema.safeParse({ ...draft, updatedAt: new Date().toISOString() });
            if (!parsed.success) {
              setIssues(zodIssues(parsed.error));
              return;
            }
            const broken = integrityIssues(parsed.data);
            if (broken.length) {
              setIssues(broken);
              return;
            }
            const saved = await onSave(parsed.data);
            if (saved?.length) {
              setIssues(saved);
              return;
            }
            onOpenChange(false);
          }}
        >
          <Label className="grid gap-1">
            Name
            <Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </Label>
          <Label className="grid gap-1">
            Summary
            <Textarea value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} />
          </Label>
          <div className="grid gap-2 sm:grid-cols-2">
            <Label className="grid gap-1">
              Status
              <select
                className="h-8 rounded-lg border bg-transparent px-2 text-sm"
                value={draft.status}
                onChange={(event) => setDraft({ ...draft, status: event.target.value as Trip["status"] })}
              >
                <option value="proposed">Proposed</option>
                <option value="draft">Draft</option>
                <option value="confirmed">Confirmed</option>
              </select>
            </Label>
            <Label className="grid gap-1">
              Time zone
              <Input value={draft.timezone} onChange={(event) => setDraft({ ...draft, timezone: event.target.value })} />
            </Label>
          </div>
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <h3 className="font-medium">Days</h3>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  const last = draft.days[draft.days.length - 1];
                  setDraft({
                    ...draft,
                    days: [
                      ...draft.days,
                      {
                        id: createId("day"),
                        date: last?.date ?? new Date().toISOString().slice(0, 10),
                        title: `Day ${draft.days.length + 1}`,
                        notes: "",
                      },
                    ],
                  });
                }}
              >
                Add day
              </Button>
            </div>
            {draft.days.map((day, dayIndex) => (
              <div key={day.id} className="grid gap-2 rounded-lg border p-2">
                <div className="grid gap-2 sm:grid-cols-[9rem_1fr_auto]">
                  <Input
                    type="date"
                    value={day.date}
                    onChange={(event) => {
                      const days = draft.days.slice();
                      days[dayIndex] = { ...day, date: event.target.value };
                      setDraft({ ...draft, days });
                    }}
                  />
                  <Input
                    value={day.title}
                    onChange={(event) => {
                      const days = draft.days.slice();
                      days[dayIndex] = { ...day, title: event.target.value };
                      setDraft({ ...draft, days });
                    }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (draft.stops.some((stop) => stop.dayId === day.id)) {
                        setIssues([`Move stops off ${day.title} before deleting that day.`]);
                        return;
                      }
                      setDraft({ ...draft, days: draft.days.filter((item) => item.id !== day.id) });
                    }}
                  >
                    Remove
                  </Button>
                </div>
                <Textarea
                  value={day.notes}
                  placeholder="Day notes"
                  onChange={(event) => {
                    const days = draft.days.slice();
                    days[dayIndex] = { ...day, notes: event.target.value };
                    setDraft({ ...draft, days });
                  }}
                />
                {!isRealDate(day.date) ? <p className="text-xs text-destructive">That date is not valid.</p> : null}
                {!isValidTimeZone(draft.timezone) ? null : null}
              </div>
            ))}
          </div>
          {issues.length > 0 ? (
            <ul className="list-disc pl-5 text-sm text-destructive">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}
          <DialogFooter>
            <Button type="submit">Save trip</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function StopEditor({
  open,
  trip,
  draft,
  insertAt,
  onOpenChange,
  onDraft,
  onSave,
}: {
  open: boolean;
  trip: Trip;
  draft: StopDraft;
  insertAt: number | null;
  onOpenChange: (open: boolean) => void;
  onDraft: (draft: StopDraft) => void;
  onSave: (trip: Trip, index: number) => Promise<string[] | null>;
}) {
  const [issues, setIssues] = useState<string[]>([]);
  const uses = draft.stopId
    ? locationUseCount(trip, trip.stops.find((stop) => stop.id === draft.stopId)?.locationId ?? "")
    : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="waymark-dialog max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{draft.stopId ? "Edit stop" : "Add stop"}</DialogTitle>
          <DialogDescription>
            {uses > 1
              ? `This pin is shared by ${uses} stops. Saving edits changes all of them unless you split it.`
              : "Address search is off. Enter a name and the latitude and longitude."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={async (event) => {
            event.preventDefault();
            const applied = applyStopDraft(trip, draft, insertAt, new Date().toISOString(), createId);
            if (!applied.ok) {
              setIssues(applied.issues);
              return;
            }
            const saved = await onSave(applied.trip, applied.index);
            if (saved?.length) {
              setIssues(saved);
              return;
            }
            onOpenChange(false);
          }}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <Label className="grid gap-1">
              Day
              <select
                className="h-8 rounded-lg border bg-transparent px-2 text-sm"
                value={draft.dayId}
                onChange={(event) => onDraft({ ...draft, dayId: event.target.value })}
              >
                {trip.days.map((day) => (
                  <option key={day.id} value={day.id}>
                    {day.date} · {day.title}
                  </option>
                ))}
              </select>
            </Label>
            <Label className="grid gap-1">
              Status
              <select
                className="h-8 rounded-lg border bg-transparent px-2 text-sm"
                value={draft.status}
                onChange={(event) => onDraft({ ...draft, status: event.target.value as Stop["status"] })}
              >
                <option value="proposed">Proposed</option>
                <option value="confirmed">Confirmed</option>
                <option value="optional">Optional</option>
                <option value="buffer">Same-place rest</option>
              </select>
            </Label>
          </div>
          <Label className="grid gap-1">
            Planned time
            <Input value={draft.plannedTime} onChange={(event) => onDraft({ ...draft, plannedTime: event.target.value })} />
          </Label>
          <Label className="grid gap-1">
            Use a saved place unchanged
            <select
              className="h-8 rounded-lg border bg-transparent px-2 text-sm"
              value={draft.reuseLocationId ?? ""}
              onChange={(event) =>
                onDraft({
                  ...draft,
                  reuseLocationId: event.target.value || null,
                  detach: false,
                })
              }
            >
              <option value="">Edit the fields below</option>
              {trip.locations.map((place) => (
                <option key={place.id} value={place.id}>
                  {place.name}
                </option>
              ))}
            </select>
          </Label>
          {draft.reuseLocationId ? null : (
            <>
              <Label className="grid gap-1">
                Place name
                <Input value={draft.name} onChange={(event) => onDraft({ ...draft, name: event.target.value })} />
              </Label>
              <Label className="grid gap-1">
                Address
                <Input value={draft.address} onChange={(event) => onDraft({ ...draft, address: event.target.value })} />
              </Label>
              <div className="grid gap-2 sm:grid-cols-2">
                <Label className="grid gap-1">
                  Latitude
                  <Input inputMode="decimal" value={draft.lat} onChange={(event) => onDraft({ ...draft, lat: event.target.value })} />
                </Label>
                <Label className="grid gap-1">
                  Longitude
                  <Input inputMode="decimal" value={draft.lon} onChange={(event) => onDraft({ ...draft, lon: event.target.value })} />
                </Label>
              </div>
              <Label className="grid gap-1">
                What this pin is
                <Textarea value={draft.pinNote} onChange={(event) => onDraft({ ...draft, pinNote: event.target.value })} />
              </Label>
              <p className="text-xs text-muted-foreground">
                Address search is unavailable. The public geocoder refuses browser requests, so coordinates are entered here.
              </p>
              {uses > 1 ? (
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={draft.detach}
                    onChange={(event) => onDraft({ ...draft, detach: event.target.checked })}
                  />
                  <span>Save these coordinates as a new pin for this stop only. The other stops keep the old place.</span>
                </label>
              ) : null}
            </>
          )}
          <Label className="grid gap-1">
            Notes
            <Textarea value={draft.notes} onChange={(event) => onDraft({ ...draft, notes: event.target.value })} />
          </Label>
          <Label className="grid gap-1">
            Access caveat
            <Textarea value={draft.access} onChange={(event) => onDraft({ ...draft, access: event.target.value })} />
          </Label>
          {issues.length > 0 ? (
            <ul className="list-disc pl-5 text-sm text-destructive">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}
          <DialogFooter>
            <Button type="submit">Save stop</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
