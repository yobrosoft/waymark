"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDelete, HelpDialog, LibraryDialog, StopEditor, TripEditor } from "@/components/dialogs";
import { downloadJson } from "@/components/download";
import { TripMap, type Camera, type CameraSpec } from "@/components/trip-map";
import { useTripBook } from "@/components/use-trip-book";
import {
  formatDay,
  formatDistance,
  formatDuration,
  formatWhen,
  MODE_LABEL,
  STOP_STATUS_LABEL,
  TRIP_STATUS_LABEL,
} from "@/lib/format";
import { slugify } from "@/lib/ids";
import { resolveNearby } from "@/lib/lookups";
import { googleDirectionsUrl, googlePlaceUrl, NEARBY_CATEGORIES } from "@/lib/providers";
import { resolveRoute, routeLine } from "@/lib/routing";
import {
  deleteStop,
  firstStopIndexForDay,
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
  const [planExpanded, setPlanExpanded] = useState(false);
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
  const [otherOpen, setOtherOpen] = useState(false);

  const trip = book.trip;
  const index = book.index;
  const leg = trip ? selectedLeg(trip, index) : null;
  const legId = leg ? `${leg.fromStop.id}>${leg.toStop.id}:${leg.mode}:${leg.samePlace}` : "start";
  const places = useMemo(() => (trip ? placesById(trip) : new Map()), [trip]);
  const markers = useMemo(() => (trip ? mapPlaces(trip, index) : []), [trip, index]);
  const warnings = trip ? sequenceWarnings(trip) : [];
  const stop = trip?.stops[index];
  const place = stop ? places.get(stop.locationId) : undefined;
  const day = trip?.days.find((item) => item.id === stop?.dayId);
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
    setNearby({ status: "idle" });
    setNearbyCategory(null);
    setOtherOpen(false);
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

  if (book.status === "loading") {
    return (
      <main className="grid min-h-dvh place-items-center bg-background px-6">
        <p className="max-w-sm text-center text-muted-foreground">Opening the trip book saved in this browser…</p>
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

  return (
    <div className="waymark-shell bg-background text-foreground" data-plan={planExpanded ? "expanded" : "peek"}>
      <header className="waymark-header flex items-center justify-between gap-3 border-b px-3 py-2 sm:px-4">
        <div className="min-w-0">
          <p className="font-heading text-lg leading-none">Waymark</p>
          <p className="truncate text-xs text-muted-foreground">Trips stay in this browser</p>
        </div>
        <div className="hidden min-w-0 text-center sm:block">
          <p className="truncate font-heading text-base">{trip?.name ?? "No trip open"}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setLibraryOpen(true)}>
            Library
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setHelpOpen(true)}>
            Help
          </Button>
        </div>
      </header>

      <section className="waymark-map relative min-h-0 bg-[#d5ddd6]" aria-label="Map">
        <TripMap
          places={markers}
          line={line}
          mode={leg?.mode ?? "driving"}
          nearby={nearby.status === "ready" ? nearby.places : []}
          camera={camera}
          onSelectLocation={(locationId) => {
            if (!trip) return;
            book.setIndex((current) => selectPinIndex(trip, current, locationId));
          }}
        />
      </section>

      <aside className="waymark-panel flex min-h-0 flex-col border-t bg-card lg:border-t-0 lg:border-r" aria-label="Trip plan">
        {book.warning ? (
          <div className="flex items-start justify-between gap-2 border-b bg-amber-50 px-3 py-2 text-sm text-amber-950">
            <p>{book.warning}</p>
            <button type="button" className="shrink-0 underline" onClick={book.dismissWarning}>
              Hide
            </button>
          </div>
        ) : null}
        {!trip ? (
          <div className="grid gap-3 p-4">
            <h1 className="font-heading text-2xl">No trip in this browser</h1>
            <p className="text-sm text-muted-foreground">
              Create one, import a JSON backup, or add the sample Bangkok trip. Nothing is uploaded.
            </p>
            <Button type="button" onClick={() => setLibraryOpen(true)}>
              Open the library
            </Button>
          </div>
        ) : (
          <>
            <div className="sticky top-0 z-10 grid gap-2 border-b bg-card/95 px-3 py-2 backdrop-blur">
              <div className="flex items-center justify-between gap-2 sm:hidden">
                <p className="truncate font-heading text-sm">{trip.name}</p>
                <button type="button" className="text-xs underline" onClick={() => setPlanExpanded((value) => !value)}>
                  {planExpanded ? "Show map" : "Full plan"}
                </button>
              </div>
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {trip.days.map((item) => {
                  const active = item.id === stop?.dayId;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={active}
                      className={`shrink-0 rounded-full px-2.5 py-1 text-xs ${active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                      onClick={() => {
                        const next = firstStopIndexForDay(trip, item.id);
                        if (next >= 0) book.setIndex(next);
                      }}
                    >
                      {formatDay(item.date)}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" disabled={atStart} onClick={() => book.setIndex((current) => stepIndex(trip.stops.length, current, -1))}>
                  Back
                </Button>
                <p className="min-w-0 flex-1 text-center text-sm">
                  {trip.stops.length === 0 ? "No stops yet" : `Stop ${index + 1} of ${trip.stops.length}`}
                </p>
                <Button type="button" disabled={atEnd || trip.stops.length === 0} onClick={() => book.setIndex((current) => stepIndex(trip.stops.length, current, 1))}>
                  Next
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="ghost" onClick={() => book.setIndex(0)}>
                  Reset
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    pushCamera({
                      type: "bounds",
                      points: trip.locations.map((item) => [item.lon, item.lat]),
                      maxZoom: 12,
                    })
                  }
                >
                  Overview
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (shown.status === "ready") {
                      pushCamera({ type: "bounds", points: shown.route.geometry.coordinates, maxZoom: 15 });
                    } else if (place) {
                      pushCamera({ type: "point", lon: place.lon, lat: place.lat, zoom: index === 0 ? 13 : 15 });
                    }
                  }}
                >
                  Fit leg
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setTripEditorOpen(true)}>
                  Edit trip
                </Button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              <div className="mb-3 flex items-center gap-2">
                <Badge variant="secondary">{TRIP_STATUS_LABEL[trip.status]}</Badge>
                <p className="text-xs text-muted-foreground">{trip.timezone}</p>
              </div>
              {warnings.slice(0, 2).map((warning) => (
                <p key={warning} className="mb-2 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-950">
                  {warning}
                </p>
              ))}
              {leg ? (
                <section className="mb-3 rounded-xl border p-3" aria-live="polite">
                  <p className="text-xs tracking-wide text-muted-foreground uppercase">Selected leg</p>
                  <h2 className="mt-1 font-heading text-lg leading-tight">
                    {leg.from.name}
                    <span className="text-muted-foreground"> → </span>
                    {leg.to.name}
                  </h2>
                  {leg.samePlace ? (
                    <p className="mt-2 text-sm">
                      Same place. No road route was requested. This stop continues at {leg.to.name}.
                    </p>
                  ) : (
                    <>
                      <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Travel mode">
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
                        <Button type="button" size="sm" variant="ghost" onClick={() => setOtherOpen((value) => !value)}>
                          Other
                        </Button>
                      </div>
                      {shown.status === "loading" ? <p className="mt-3 text-sm">Asking the routing service for this leg…</p> : null}
                      {shown.status === "ready" ? (
                        <div className="mt-3">
                          <p className="font-heading text-2xl">
                            {formatDistance(shown.route.distanceMeters)}
                            <span className="text-muted-foreground"> · </span>
                            {formatDuration(shown.route.durationSeconds)}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Typical {MODE_LABEL[shown.route.mode].toLowerCase()} time from OSRM via FOSSGIS. Not live traffic.
                            {shown.fromCache ? ` Cached result from ${formatWhen(shown.route.fetchedAt)}.` : " Just fetched."}
                          </p>
                        </div>
                      ) : null}
                      {shown.status === "error" ? (
                        <div className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm">
                          <p className="font-medium">Route unavailable</p>
                          <p className="mt-1">{shown.message}</p>
                          <Button type="button" size="sm" className="mt-2" variant="outline" onClick={() => setRetry((value) => value + 1)}>
                            Retry this leg
                          </Button>
                        </div>
                      ) : null}
                      {otherOpen ? (
                        <p className="mt-2 text-xs text-muted-foreground">
                          Transit, taxi, and rideshare times are not estimated here.
                        </p>
                      ) : null}
                      <div className="mt-3 flex flex-wrap gap-2 text-sm">
                        <a className="underline" href={googleDirectionsUrl(leg.from, leg.to, "driving")} target="_blank" rel="noreferrer">
                          Google drive
                        </a>
                        <a className="underline" href={googleDirectionsUrl(leg.from, leg.to, "walking")} target="_blank" rel="noreferrer">
                          Google walk
                        </a>
                        <a className="underline" href={googleDirectionsUrl(leg.from, leg.to, "transit")} target="_blank" rel="noreferrer">
                          Google transit
                        </a>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Those pages use Google&apos;s own times. This app does not copy them. The driving link asks Google to avoid ferries.
                      </p>
                    </>
                  )}
                </section>
              ) : null}

              {stop && place && day ? (
                <section className="rounded-xl border p-3">
                  <p className="text-xs text-muted-foreground">
                    {formatDay(day.date)} · {day.title}
                  </p>
                  <div className="mt-1 flex items-start justify-between gap-2">
                    <h2 className="font-heading text-2xl leading-tight">{place.name}</h2>
                    <Badge variant="outline">{STOP_STATUS_LABEL[stop.status]}</Badge>
                  </div>
                  {stop.plannedTime ? <p className="mt-2 text-sm font-medium">{stop.plannedTime}</p> : null}
                  {place.address ? <p className="mt-2 text-sm">{place.address}</p> : null}
                  {stop.notes ? <p className="mt-2 text-sm text-muted-foreground">{stop.notes}</p> : null}
                  {day.notes ? <p className="mt-2 text-sm text-muted-foreground">{day.notes}</p> : null}
                  {stop.access ? (
                    <p className="mt-2 rounded-md bg-muted px-2 py-1.5 text-sm">
                      <span className="font-medium">Access. </span>
                      {stop.access}
                    </p>
                  ) : null}
                  {place.pinNote ? <p className="mt-2 text-xs text-muted-foreground">{place.pinNote}</p> : null}
                  <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                    {place.lat.toFixed(5)}, {place.lon.toFixed(5)}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setStopDraft(draftFromStop(stop, places, day.id));
                        setInsertAt(null);
                        setStopEditorOpen(true);
                      }}
                    >
                      Edit stop
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setStopDraft(emptyDraft(day.id));
                        setInsertAt(index + 1);
                        setStopEditorOpen(true);
                      }}
                    >
                      Add after
                    </Button>
                    <Button type="button" size="sm" variant="ghost" disabled={trip.stops.length === 0} onClick={() => setDeleteStopId(stop.id)}>
                      Remove
                    </Button>
                    <a className="inline-flex h-7 items-center text-sm underline" href={googlePlaceUrl(place.name, place.address, place)} target="_blank" rel="noreferrer">
                      Google Maps
                    </a>
                  </div>
                  <div className="mt-3">
                    <p className="text-xs font-medium">Nearby in OpenStreetMap, 700 m</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Restaurants and landmarks on the map are Google’s. This list is a separate search.
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {(Object.keys(NEARBY_CATEGORIES) as NearbyCategory[]).map((category) => (
                        <Button
                          key={category}
                          type="button"
                          size="sm"
                          variant={nearbyCategory === category ? "default" : "outline"}
                          onClick={() => void loadNearby(category)}
                        >
                          {NEARBY_CATEGORIES[category].label}
                        </Button>
                      ))}
                    </div>
                    {nearby.status === "loading" ? <p className="mt-2 text-sm">Looking up mapped places…</p> : null}
                    {nearby.status === "error" ? <p className="mt-2 text-sm text-destructive">{nearby.message}</p> : null}
                    {nearby.status === "ready" && nearby.places.length === 0 ? (
                      <p className="mt-2 text-sm text-muted-foreground">
                        No named {NEARBY_CATEGORIES[nearbyCategory ?? "food"].label.toLowerCase()} in the OpenStreetMap data within 700 m. Google’s map may still show places.
                      </p>
                    ) : null}
                    {nearby.status === "ready" && nearby.places.length > 0 ? (
                      <ul className="mt-2 grid gap-1.5">
                        {nearby.fromCache ? <li className="text-xs text-muted-foreground">Cached nearby list.</li> : null}
                        {nearby.places.map((item) => (
                          <li key={item.id} className="rounded-md border px-2 py-1.5 text-sm">
                            <p className="font-medium">{item.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {item.kind} · {formatDistance(item.straightLineMeters)} straight-line, not a walk time
                            </p>
                            <span className="mt-1 flex gap-3 text-xs">
                              <a className="underline" href={googlePlaceUrl(item.name, "", item)} target="_blank" rel="noreferrer">
                                Google Maps
                              </a>
                              <a className="underline" href={item.osmUrl} target="_blank" rel="noreferrer">
                                OpenStreetMap
                              </a>
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </section>
              ) : (
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
              )}

              <ol className="mt-4 grid gap-1">
                {trip.stops.map((item, stopIndex) => {
                  const itemPlace = places.get(item.locationId);
                  const itemDay = trip.days.find((candidate) => candidate.id === item.dayId);
                  const active = stopIndex === index;
                  return (
                    <li key={item.id}>
                      <div className={`flex items-stretch gap-1 rounded-lg border ${active ? "border-primary bg-primary/5" : "border-transparent bg-muted/40"}`}>
                        <button type="button" className="min-w-0 flex-1 px-2 py-1.5 text-left" onClick={() => book.setIndex(stopIndex)}>
                          <span className="text-xs text-muted-foreground">
                            {stopIndex + 1}
                            {itemDay ? ` · ${formatDay(itemDay.date)}` : ""}
                            {item.status === "buffer" ? " · rest" : ""}
                          </span>
                          <span className="block truncate text-sm">{itemPlace?.name ?? "Missing place"}</span>
                        </button>
                        <div className="flex flex-col justify-center pr-1">
                          <button type="button" className="px-1 text-xs disabled:opacity-40" aria-label={`Move stop ${stopIndex + 1} up`} onClick={() => void reorder(stopIndex, -1)}>
                            Up
                          </button>
                          <button type="button" className="px-1 text-xs disabled:opacity-40" aria-label={`Move stop ${stopIndex + 1} down`} onClick={() => void reorder(stopIndex, 1)}>
                            Down
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
              <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
                Map © Google · Routes © OSRM / FOSSGIS, not live traffic.
                {" "}
                <button type="button" className="underline" onClick={() => downloadJson(`waymark-${slugify(trip.name)}.json`, book.exportTrip())}>
                  Export this trip
                </button>
              </p>
            </div>
          </>
        )}
      </aside>

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

  async function reorder(stopIndex: number, direction: -1 | 1) {
    if (!trip) return;
    const currentId = trip.stops[index]?.id;
    const next = moveStop(trip, stopIndex, direction, new Date().toISOString());
    if (next === trip) return;
    const nextIndex = currentId ? next.stops.findIndex((item) => item.id === currentId) : index;
    await book.commitTrip(next, nextIndex < 0 ? 0 : nextIndex);
  }
}
