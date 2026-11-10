"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { AccountGate } from "@/components/account-gate";
import { AgentBar } from "@/components/agent-bar";
import { ConfirmDelete, HelpDialog, LibraryDialog, StopEditor, TripEditor } from "@/components/dialogs";
import { useAgentLink } from "@/components/use-agent-link";
import { downloadJson } from "@/components/download";
import { TripMap, type Camera, type CameraSpec } from "@/components/trip-map";
import { TripTimeline } from "@/components/trip-timeline";
import { useTripBook } from "@/components/use-trip-book";
import { approximateTime, formatDay, formatDistance, formatDuration, formatWhen, isNightTime, MODE_LABEL } from "@/lib/format";
import { createShareLink } from "@/lib/account";
import { resolveNearby } from "@/lib/lookups";
import { googleDirectionsUrl } from "@/lib/providers";
import { resolveRoute, routeLine } from "@/lib/routing";
import {
  deleteStop,
  mapPlaces,
  moveStop,
  placesById,
  selectedLeg,
  selectPinIndex,
  sequenceWarnings,
  stepIndex,
  type StopDraft,
} from "@/lib/trip-logic";
import type { LegMode, NearbyCategory, NearbyPlace, RouteView, Stop } from "@/lib/types";

const MODES: LegMode[] = ["driving", "walking", "cycling"];

function emptyDraft(dayId: string): StopDraft {
  return {
    stopId: null,
    dayId,
    plannedTime: "",
    status: "proposed",
    notes: "",
    access: "",
    reuseLocationId: null,
    detach: false,
    name: "",
    address: "",
    lat: "",
    lon: "",
    pinNote: "",
  };
}

function draftFromStop(stop: Stop, places: ReturnType<typeof placesById>, dayId: string): StopDraft {
  const place = places.get(stop.locationId);
  return {
    stopId: stop.id,
    dayId: stop.dayId || dayId,
    plannedTime: stop.plannedTime,
    status: stop.status,
    notes: stop.notes,
    access: stop.access,
    reuseLocationId: null,
    detach: false,
    name: place?.name ?? "",
    address: place?.address ?? "",
    lat: place ? String(place.lat) : "",
    lon: place ? String(place.lon) : "",
    pinNote: place?.pinNote ?? "",
  };
}

export function Planner() {
  const book = useTripBook();
  const bookRef = useRef(book);
  bookRef.current = book;
  const [route, setRoute] = useState<{ legId: string; view: RouteView }>({
    legId: "",
    view: { status: "idle" },
  });
  const [retry, setRetry] = useState(0);
  const [camera, setCamera] = useState<Camera | null>(null);
  const cameraId = useRef(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [tripEditorOpen, setTripEditorOpen] = useState(false);
  const [stopEditorOpen, setStopEditorOpen] = useState(false);
  const [stopDraft, setStopDraft] = useState<StopDraft | null>(null);
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const [deleteStopId, setDeleteStopId] = useState<string | null>(null);
  const [nearbyCategory, setNearbyCategory] = useState<NearbyCategory | null>(null);
  const [nearby, setNearby] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "ready"; places: NearbyPlace[]; fromCache: boolean }
    | { status: "error"; message: string }
  >({ status: "idle" });
  const [view, setView] = useState<"map" | "timeline">("map");
  const [otherOpen, setOtherOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const savedTrip = book.trip;
  const link = useAgentLink(savedTrip);
  const trip = link.preview && link.pending ? link.pending.trip : savedTrip;
  const index = book.index;
  const leg = trip ? selectedLeg(trip, index) : null;
  const legId = leg ? `${leg.fromStop.id}>${leg.toStop.id}:${leg.mode}:${leg.samePlace}` : "start";
  const places = useMemo(() => (trip ? placesById(trip) : new Map()), [trip]);
  const markers = useMemo(() => (trip ? mapPlaces(trip, index) : []), [trip, index]);
  const warnings = trip ? sequenceWarnings(trip) : [];
  const stop = trip?.stops[index];
  const place = stop ? places.get(stop.locationId) : undefined;
  const shown: RouteView = !leg
    ? { status: "idle" }
    : leg.samePlace
      ? { status: "same-place" }
      : route.legId === legId
        ? route.view
        : { status: "loading" };
  const shownKey =
    shown.status === "ready"
      ? `ready:${shown.route.fetchedAt}`
      : shown.status === "error"
        ? `error:${shown.message}`
        : shown.status;

  function pushCamera(spec: CameraSpec) {
    cameraId.current += 1;
    const id = cameraId.current;
    if (spec.type === "point") setCamera({ ...spec, id });
    else setCamera({ ...spec, id });
  }

  useEffect(() => {
    if (!trip) return;
    const current = selectedLeg(trip, index);
    if (!current || current.samePlace) {
      setRoute({ legId, view: { status: current?.samePlace ? "same-place" : "idle" } });
      return;
    }
    const ac = new AbortController();
    setRoute({ legId, view: { status: "loading" } });
    resolveRoute({
      samePlace: false,
      mode: current.mode,
      from: current.from,
      to: current.to,
      signal: ac.signal,
      cacheGet: (key) => bookRef.current.routeCacheGet(key),
      cacheSet: (key, value) => bookRef.current.routeCacheSet(key, value),
    }).then((result) => {
      if (!ac.signal.aborted) setRoute({ legId, view: result });
    });
    return () => ac.abort();
  }, [trip, index, legId, retry]);

  useEffect(() => {
    if (!trip || !place) return;
    if (index === 0 || !leg) {
      pushCamera({ type: "point", lon: place.lon, lat: place.lat, zoom: 13 });
      return;
    }
    if (shown.status === "loading" || shown.status === "idle") return;
    if (shown.status === "ready") {
      pushCamera({ type: "bounds", points: shown.route.geometry.coordinates, maxZoom: 15 });
    } else if (shown.status === "same-place") {
      pushCamera({ type: "point", lon: place.lon, lat: place.lat, zoom: 15 });
    } else if (shown.status === "error" && leg) {
      pushCamera({
        type: "bounds",
        points: [
          [leg.from.lon, leg.from.lat],
          [leg.to.lon, leg.to.lat],
        ],
        maxZoom: 13,
      });
    }
    // Fit when the selected stop or its route result changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip?.id, index, legId, shownKey]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) {
        return;
      }
      if (!trip) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        bookRef.current.setIndex((current) => stepIndex(trip.stops.length, current, 1));
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        bookRef.current.setIndex((current) => stepIndex(trip.stops.length, current, -1));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [trip]);

  useEffect(() => {
    setOtherOpen(false);
    setNearby({ status: "idle" });
    setNearbyCategory(null);
  }, [trip?.id, index]);

  async function loadNearby(category: NearbyCategory) {
    if (!place) return;
    setNearbyCategory(category);
    setNearby({ status: "loading" });
    const result = await resolveNearby({
      category,
      lat: place.lat,
      lon: place.lon,
      cacheGet: (key) => bookRef.current.nearbyCacheGet(key),
      cacheSet: (key, value) => bookRef.current.nearbyCacheSet(key, value),
    });
    if (!result.ok) {
      setNearby({ status: "error", message: result.error === "cancelled" ? "Nearby search was cancelled." : result.error });
      return;
    }
    setNearby({ status: "ready", places: result.places, fromCache: result.fromCache });
  }

  if (book.status === "signed-out") {
    return <AccountGate warning={book.warning} onToken={book.signIn} />;
  }

  if (book.status === "loading") {
    return (
      <main className="grid min-h-dvh place-items-center bg-background px-6">
        <p className="max-w-sm text-center text-muted-foreground">
          {book.accountMode ? "Opening the trips in this account…" : "Opening the trip book saved in this browser…"}
        </p>
      </main>
    );
  }

  if (book.status === "blocked" && book.block) {
    return (
      <main className="mx-auto grid min-h-dvh max-w-xl content-center gap-4 px-6 py-12">
        <p className="font-heading text-3xl">This trip book could not be opened</p>
        <p>{book.block.message}</p>
        <ul className="list-disc pl-5 text-sm text-muted-foreground">
          {book.block.issues.slice(0, 8).map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => downloadJson(`waymark-unreadable-${Date.now()}.json`, book.block?.raw ?? null)}
          >
            Download the unreadable save
          </Button>
          <Button type="button" variant="destructive" onClick={() => void book.replaceBlocked()}>
            Replace it with the sample trip
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          The sample is not written until you use that button. Your saved file stays as it is until then.
        </p>
      </main>
    );
  }

  if (!book.library) return null;

  const line = routeLine(shown);
  const atStart = index <= 0;
  const atEnd = !trip || index >= trip.stops.length - 1;
  const day = stop ? trip?.days.find((item) => item.id === stop.dayId) : undefined;
  const night = Boolean(stop && isNightTime(stop.plannedTime));
  const dayLabel = day ? `${formatDay(day.date)} · ${day.title}` : trip?.name ?? "No trip open";
  const when = stop ? approximateTime(stop.plannedTime) : "";

  async function reorder(stopIndex: number, direction: -1 | 1) {
    if (!trip) return;
    const currentId = trip.stops[index]?.id;
    const next = moveStop(trip, stopIndex, direction, new Date().toISOString());
    if (next === trip) return;
    const nextIndex = currentId ? next.stops.findIndex((item) => item.id === currentId) : index;
    await book.commitTrip(next, nextIndex < 0 ? 0 : nextIndex);
  }

  function editCurrentStop() {
    if (!trip || !stop) return;
    const itemDay = trip.days.find((candidate) => candidate.id === stop.dayId) ?? trip.days[0];
    setStopDraft(draftFromStop(stop, places, itemDay.id));
    setInsertAt(null);
    setStopEditorOpen(true);
  }

  return (
    <div className="waymark-shell bg-background text-foreground" data-night={night ? "true" : "false"}>
      <div className="waymark-banner border-b">
      <header className="grid gap-2 px-3 py-2 backdrop-blur-xl sm:px-4">
        <div className="flex min-w-0 items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-heading text-lg leading-tight">{dayLabel}</p>
          <p className={`truncate text-sm ${night ? "text-[#aeaeb2]" : "text-muted-foreground"}`}>
            {book.readonly
              ? "Shared view"
              : place
                ? `${when === "—" ? "" : `${when} · `}${place.name}`
                : trip
                  ? "No stop selected"
                  : "Open a trip to see it on the map"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex rounded-full bg-black/10 p-0.5" role="group" aria-label="Choose map or timeline">
            <Button type="button" size="sm" variant={view === "map" ? "default" : "outline"} aria-pressed={view === "map"} onClick={() => setView("map")}>
              Map
            </Button>
            <Button
              type="button"
              size="sm"
              variant={view === "timeline" ? "default" : "outline"}
              aria-pressed={view === "timeline"}
              onClick={() => setView("timeline")}
            >
              Timeline
            </Button>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={atStart || !trip}
            onClick={() => trip && book.setIndex((current) => stepIndex(trip.stops.length, current, -1))}
          >
            Back
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={atEnd || !trip || trip.stops.length === 0}
            onClick={() => trip && book.setIndex((current) => stepIndex(trip.stops.length, current, 1))}
          >
            Next
          </Button>
        </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {book.accountMode && !book.readonly && trip ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void createShareLink(trip.id)
                  .then((token) => navigator.clipboard.writeText(`${window.location.origin}/?share=${token}`))
                  .then(() => setNotice("View link copied."))
                  .catch((err: unknown) => setNotice(err instanceof Error ? err.message : "The share link was not created."));
              }}
            >
              Share
            </Button>
          ) : null}
          {book.accountMode && !book.readonly ? (
            <Button type="button" variant="ghost" size="sm" onClick={book.signOut}>
              Sign out
            </Button>
          ) : null}
          {!book.accountMode && link.configured && !link.sharing ? (
            <Button type="button" variant="outline" size="sm" disabled={link.busy} onClick={() => void link.start()}>
              Share
            </Button>
          ) : null}
          {!book.accountMode && link.sharing && !link.pending ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => void link.stop()}>
              Stop sharing
            </Button>
          ) : null}
          <Button type="button" variant="outline" size="sm" onClick={() => setLibraryOpen(true)}>
            Library
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setHelpOpen(true)}>
            Help
          </Button>
          {stop ? (
            <Button type="button" variant="ghost" size="sm" onClick={editCurrentStop}>
              Edit
            </Button>
          ) : null}
        </div>
      </header>

      {!book.accountMode && (link.pending || link.remoteTrip) ? (
        <AgentBar
          trip={savedTrip}
          link={link}
          onApplied={(next, index) => book.commitTrip(next, index)}
          onOpenShared={async (tripId) => {
            const shared = await link.fetchTrip(tripId);
            if (!shared) return;
            const message = await book.importTrips([shared], "replace");
            if (message) return;
            await book.selectTrip(tripId);
          }}
        />
      ) : null}
      {book.warning ? (
        <p className="flex items-start justify-between gap-2 border-t px-3 py-2 text-sm">
          <span>{book.warning}</span>
          <button type="button" className="shrink-0 underline" onClick={book.dismissWarning}>
            Hide
          </button>
        </p>
      ) : null}
      </div>

      <section className="waymark-map relative min-h-0">
        <div className={view === "map" ? `relative h-full min-h-0 ${night ? "bg-[#1c1c1e]" : "bg-[#e5e5ea]"}` : "hidden"} hidden={view !== "map"}>
        <TripMap
          places={markers}
          line={line}
          mode={leg?.mode ?? "driving"}
          nearby={nearby.status === "ready" ? nearby.places : []}
          night={night}
          active={view === "map"}
          camera={camera}
          onSelectLocation={(locationId) => {
            if (!trip) return;
            book.setIndex((current) => selectPinIndex(trip, current, locationId));
          }}
        />
        {!trip ? (
          <div className="absolute inset-0 z-10 grid place-items-center bg-background/80 p-6">
            <div className="grid max-w-sm gap-3 text-center">
              <h1 className="font-heading text-2xl">{book.accountMode ? "No trip in this account" : "No trip in this browser"}</h1>
              <p className="text-sm text-muted-foreground">
                {book.accountMode
                  ? "Create one here, or let an agent create it after you connect it to this account."
                  : "Create one, import a JSON backup, or add the sample Bangkok trip. Nothing is uploaded."}
              </p>
              <Button type="button" onClick={() => setLibraryOpen(true)}>
                Open the library
              </Button>
            </div>
          </div>
        ) : null}
        {trip && trip.stops.length === 0 ? (
          <div className="absolute inset-x-0 bottom-4 z-10 mx-auto grid w-[min(24rem,calc(100%-2rem))] gap-2 rounded-2xl bg-card p-4 shadow-lg">
            <h2 className="font-heading text-xl">This trip has no stops</h2>
            <p className="text-sm text-muted-foreground">Search for a real place, or type coordinates. A blank pin is not added for you.</p>
            <Button
              type="button"
              onClick={() => {
                setStopDraft(emptyDraft(trip.days[0].id));
                setInsertAt(0);
                setStopEditorOpen(true);
              }}
            >
              Add the first stop
            </Button>
          </div>
        ) : null}
        {trip && leg ? (
          <div className="pointer-events-none absolute right-3 bottom-8 left-14 z-10 flex justify-center">
            <section className="waymark-route pointer-events-auto w-full max-w-xl rounded-2xl px-3 py-2 text-sm shadow-lg" aria-live="polite">
              {leg.samePlace ? (
                <p className="px-1">Same place. No road route was requested.</p>
              ) : (
                <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Travel mode">
                  {MODES.map((mode) => (
                    <Button
                      key={mode}
                      type="button"
                      size="sm"
                      variant={leg.mode === mode ? "default" : "outline"}
                      onClick={() => void book.setMode(mode)}
                    >
                      {MODE_LABEL[mode]}
                    </Button>
                  ))}
                  {shown.status === "ready" ? (
                    <p className={`text-xs ${night ? "text-[#aeaeb2]" : "text-muted-foreground"}`}>
                      {formatDistance(shown.route.distanceMeters)} · {formatDuration(shown.route.durationSeconds)}
                    </p>
                  ) : null}
                  {shown.status === "loading" ? <p className="text-xs">Routing…</p> : null}
                  {shown.status === "ready" ? (
                    <p className={`hidden text-xs sm:block ${night ? "text-[#aeaeb2]" : "text-muted-foreground"}`}>
                      Typical {MODE_LABEL[shown.route.mode].toLowerCase()} time from OSRM via FOSSGIS. Not live traffic.
                      {shown.fromCache ? ` Cached result from ${formatWhen(shown.route.fetchedAt)}.` : " Just fetched."}
                    </p>
                  ) : null}
                  {shown.status === "error" ? (
                    <Button type="button" size="sm" variant="outline" onClick={() => setRetry((value) => value + 1)}>
                      Retry this leg
                    </Button>
                  ) : null}
                  <Button type="button" size="sm" variant="ghost" onClick={() => setOtherOpen((value) => !value)}>
                    Other
                  </Button>
                </div>
              )}
              {otherOpen && !leg.samePlace ? (
                <p className={`mt-1 px-1 text-xs ${night ? "text-[#aeaeb2]" : "text-muted-foreground"}`}>
                  Transit, taxi, and rideshare times are not estimated here.{" "}
                  <a className="underline" href={googleDirectionsUrl(leg.from, leg.to, "transit")} target="_blank" rel="noreferrer">
                    Google transit
                  </a>
                </p>
              ) : null}
            </section>
          </div>
        ) : null}
        {warnings[0] ? (
          <p className="absolute inset-x-3 top-3 z-10 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-950 shadow">{warnings[0]}</p>
        ) : null}
        {notice ? <p className="absolute inset-x-3 top-3 z-10 rounded-xl bg-card px-3 py-2 text-xs shadow">{notice}</p> : null}
        </div>
        <div
          className={view === "timeline" ? "h-full min-h-0 overflow-y-auto bg-background px-3 py-3" : "hidden"}
          hidden={view !== "timeline"}
        >
          {warnings.slice(0, 2).map((warning) => (
            <p key={warning} className="mb-2 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-950">
              {warning}
            </p>
          ))}
          {!trip ? (
            <div className="grid max-w-sm gap-3">
              <h1 className="font-heading text-2xl">{book.accountMode ? "No trip in this account" : "No trip in this browser"}</h1>
              <Button type="button" onClick={() => setLibraryOpen(true)}>
                Open the library
              </Button>
            </div>
          ) : trip.stops.length === 0 ? (
            <section className="rounded-xl border border-dashed p-4">
              <h2 className="font-heading text-xl">This trip has no stops</h2>
              <p className="mt-1 text-sm text-muted-foreground">Search for a real place, or type coordinates. A blank pin is not added for you.</p>
              <Button
                type="button"
                className="mt-3"
                onClick={() => {
                  setStopDraft(emptyDraft(trip.days[0].id));
                  setInsertAt(0);
                  setStopEditorOpen(true);
                }}
              >
                Add the first stop
              </Button>
            </section>
          ) : (
            <TripTimeline
              trip={trip}
              index={index}
              places={places}
              onSelect={(stopIndex) => book.setIndex(stopIndex)}
              onEdit={(stopIndex) => {
                const item = trip.stops[stopIndex];
                const itemDay = trip.days.find((candidate) => candidate.id === item.dayId) ?? trip.days[0];
                setStopDraft(draftFromStop(item, places, itemDay.id));
                setInsertAt(null);
                setStopEditorOpen(true);
              }}
              onAddAfter={(stopIndex) => {
                const item = trip.stops[stopIndex];
                setStopDraft(emptyDraft(item.dayId || trip.days[0].id));
                setInsertAt(stopIndex + 1);
                setStopEditorOpen(true);
              }}
              onRemove={(stopId) => setDeleteStopId(stopId)}
              onMove={(stopIndex, direction) => void reorder(stopIndex, direction)}
              nearbyCategory={nearbyCategory}
              nearby={nearby}
              onNearby={(category) => void loadNearby(category)}
            />
          )}
        </div>
      </section>


      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
      <LibraryDialog
        open={libraryOpen}
        onOpenChange={setLibraryOpen}
        library={book.library}
        onOpenTrip={(id) => {
          void book.selectTrip(id);
          setLibraryOpen(false);
        }}
        onDuplicate={() => void book.duplicateActive()}
        onDelete={(id) => void book.removeTrip(id)}
        onCreate={(input) => book.createBlank(input)}
        onImport={(trips, mode) => book.importTrips(trips, mode)}
        onAddSample={() => book.addSample()}
      />
      {trip && tripEditorOpen ? (
        <TripEditor
          key={`${trip.id}-${trip.updatedAt}`}
          open={tripEditorOpen}
          trip={trip}
          onOpenChange={setTripEditorOpen}
          onSave={(next) => book.commitTrip(next)}
        />
      ) : null}
      {trip && stopDraft && stopEditorOpen ? (
        <StopEditor
          open={stopEditorOpen}
          trip={trip}
          draft={stopDraft}
          insertAt={insertAt}
          onOpenChange={setStopEditorOpen}
          onDraft={setStopDraft}
          onSave={(next, nextIndex) => book.commitTrip(next, nextIndex)}
        />
      ) : null}
      <ConfirmDelete
        open={deleteStopId != null}
        onOpenChange={(open) => {
          if (!open) setDeleteStopId(null);
        }}
        title="Remove this stop?"
        body="The place stays in the trip so you can use it again. This only changes the order saved in this browser."
        onConfirm={() => {
          if (!trip || !deleteStopId) return;
          const next = deleteStop(trip, deleteStopId, new Date().toISOString());
          const nextIndex = Math.max(0, Math.min(index, next.stops.length - 1));
          void book.commitTrip(next, next.stops.length ? nextIndex : 0);
        }}
      />
    </div>
  );
}

