"use client";

import { useEffect, useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { approximateTime, formatDay, nightCount, nightLabel, STOP_STATUS_LABEL } from "@/lib/format";
import { stayEstimate } from "@/lib/stay";
import { googlePlaceUrl, NEARBY_CATEGORIES } from "@/lib/providers";
import type { Day, NearbyCategory, NearbyPlace, Place, Stop, Trip } from "@/lib/types";
import type { placesById } from "@/lib/trip-logic";

type Places = ReturnType<typeof placesById>;
type NearbyState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; places: NearbyPlace[]; fromCache: boolean }
  | { status: "error"; message: string };

const nameClass = (active: boolean) =>
  `min-w-0 truncate py-1 text-left text-sm outline-none hover:underline focus-visible:underline ${
    active ? "font-medium text-foreground" : "text-foreground/80"
  }`;

function StopDetails({
  name,
  day,
  stop,
  place,
  stopIndex,
  stopCount,
  active,
  nearbyCategory,
  nearby,
  onEdit,
  onAddAfter,
  onRemove,
  onMove,
  onNearby,
}: {
  name: string;
  day: Day | undefined;
  stop: Stop;
  place: Place | undefined;
  stopIndex: number;
  stopCount: number;
  active: boolean;
  nearbyCategory: NearbyCategory | null;
  nearby: NearbyState;
  onEdit: () => void;
  onAddAfter: () => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
  onNearby: (category: NearbyCategory) => void;
}) {
  return (
    <>
      <p className="font-heading text-lg leading-tight">{name}</p>
      <p className="mt-1 text-xs text-muted-foreground">{day ? `${formatDay(day.date)} · ${day.title}` : "Unscheduled day"}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Badge variant="outline">{STOP_STATUS_LABEL[stop.status]}</Badge>
        {stop.plannedTime ? <p>{stop.plannedTime}</p> : <p className="text-muted-foreground">No planned time</p>}
      </div>
      {place?.address ? <p className="mt-2">{place.address}</p> : null}
      {stop.notes ? <p className="mt-2 text-muted-foreground">{stop.notes}</p> : null}
      {stop.access ? (
        <p className="mt-2 rounded-md bg-muted px-2 py-1.5">
          <span className="font-medium">Access. </span>
          {stop.access}
        </p>
      ) : null}
      {place?.pinNote ? <p className="mt-2 text-xs text-muted-foreground">{place.pinNote}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onEdit}>
          Edit stop
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onAddAfter}>
          Add after
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onRemove}>
          Remove
        </Button>
      </div>
      <div className="mt-2 flex gap-3 text-xs">
        <button type="button" className="underline disabled:opacity-40" disabled={stopIndex === 0} onClick={() => onMove(-1)}>
          Earlier
        </button>
        <button type="button" className="underline disabled:opacity-40" disabled={stopIndex === stopCount - 1} onClick={() => onMove(1)}>
          Later
        </button>
        {place ? (
          <a className="underline" href={googlePlaceUrl(place.name, place.address, place)} target="_blank" rel="noreferrer">
            Google Maps
          </a>
        ) : null}
      </div>
      {place ? (
        <div className="mt-3">
          <p className="text-xs font-medium">Nearby in OpenStreetMap, 700 m</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {(Object.keys(NEARBY_CATEGORIES) as NearbyCategory[]).map((category) => (
              <Button
                key={category}
                type="button"
                size="sm"
                variant={nearbyCategory === category ? "default" : "outline"}
                onClick={() => onNearby(category)}
              >
                {NEARBY_CATEGORIES[category].label}
              </Button>
            ))}
          </div>
          {active && nearby.status === "loading" ? <p className="mt-2 text-xs">Looking up mapped places…</p> : null}
          {active && nearby.status === "error" ? <p className="mt-2 text-xs text-destructive">{nearby.message}</p> : null}
          {active && nearby.status === "ready" && nearby.places.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              No named {NEARBY_CATEGORIES[nearbyCategory ?? "food"].label.toLowerCase()} in the OpenStreetMap data within 700 m.
            </p>
          ) : null}
          {active && nearby.status === "ready" && nearby.places.length > 0 ? (
            <ul className="mt-2 grid gap-1">
              {nearby.places.map((item) => (
                <li key={item.id} className="text-xs">
                  <span className="font-medium">{item.name}</span>
                  <span className="text-muted-foreground"> · {item.kind}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

export function TripTimeline({
  trip,
  index,
  places,
  onSelect,
  onEdit,
  onAddAfter,
  onRemove,
  onMove,
  nearbyCategory,
  nearby,
  onNearby,
}: {
  trip: Trip;
  index: number;
  places: Places;
  onSelect: (index: number) => void;
  onEdit: (index: number) => void;
  onAddAfter: (index: number) => void;
  onRemove: (stopId: string) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  nearbyCategory: NearbyCategory | null;
  nearby: NearbyState;
  onNearby: (category: NearbyCategory) => void;
}) {
  const activeRef = useRef<HTMLLIElement | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [index, trip.id]);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 959px)");
    const apply = () => setNarrow(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  let previousDate = "";

  return (
    <ol className="grid gap-0" aria-label="Trip timeline">
      {trip.stops.map((stop, stopIndex) => {
        const place = places.get(stop.locationId);
        const day = trip.days.find((item) => item.id === stop.dayId);
        const dayChanged = stopIndex === 0 || stop.dayId !== trip.stops[stopIndex - 1]?.dayId;
        const nights = dayChanged && previousDate && day ? nightCount(previousDate, day.date) : null;
        if (day?.date) previousDate = day.date;
        const active = stopIndex === index;
        const name = place?.name ?? "Missing place";
        const open = openId === stop.id;
        const details = (
          <StopDetails
            name={name}
            day={day}
            stop={stop}
            place={place}
            stopIndex={stopIndex}
            stopCount={trip.stops.length}
            active={active}
            nearbyCategory={nearbyCategory}
            nearby={nearby}
            onEdit={() => onEdit(stopIndex)}
            onAddAfter={() => onAddAfter(stopIndex)}
            onRemove={() => onRemove(stop.id)}
            onMove={(direction) => onMove(stopIndex, direction)}
            onNearby={onNearby}
          />
        );
        return (
          <li key={stop.id} ref={active ? activeRef : undefined}>
            {dayChanged && stopIndex > 0 ? (
              <div className="grid grid-cols-[5.5rem_1rem_minmax(0,1fr)] items-center py-2" role="separator">
                <span />
                <span className="mx-auto h-6 w-px bg-border" aria-hidden />
                <span className="text-[11px] tracking-wide text-muted-foreground uppercase">{nightLabel(nights)}</span>
              </div>
            ) : null}
            {dayChanged && day ? (
              <div className="grid grid-cols-[5.5rem_1rem_minmax(0,1fr)]">
                <span />
                <span />
                <p className="pt-1 pb-0.5 text-xs font-medium text-muted-foreground">
                  {formatDay(day.date)}
                  {day.title ? ` · ${day.title}` : ""}
                </p>
              </div>
            ) : null}
            <div className="grid grid-cols-[5.5rem_1rem_minmax(0,1fr)] gap-x-2">
              <button
                type="button"
                className="self-start pt-1.5 text-right text-xs leading-tight text-muted-foreground tabular-nums"
                onClick={() => onSelect(stopIndex)}
              >
                {approximateTime(stop.plannedTime)}
                <span className="mt-0.5 block font-medium text-foreground/80">{stayEstimate(trip, stopIndex)?.label}</span>
              </button>
              <button
                type="button"
                className="relative flex justify-center self-stretch"
                aria-label={`Show stop ${stopIndex + 1} on the map`}
                aria-current={active ? "true" : undefined}
                onClick={() => onSelect(stopIndex)}
              >
                {stopIndex < trip.stops.length - 1 ? <span className="absolute top-3 -bottom-2 w-px bg-border" aria-hidden /> : null}
                <span
                  className={`relative z-10 mt-2 size-2 shrink-0 rounded-full ${
                    stop.status === "buffer" ? "border border-primary bg-card" : "bg-primary"
                  } ${active ? "ring-2 ring-primary/30" : ""}`}
                />
              </button>
              {narrow ? (
                <button
                  type="button"
                  className={nameClass(active)}
                  aria-expanded={open}
                  onClick={() => {
                    onSelect(stopIndex);
                    setOpenId(open ? null : stop.id);
                  }}
                >
                  {name}
                </button>
              ) : (
                <Popover.Root
                  open={open}
                  onOpenChange={(next) => {
                    setOpenId(next ? stop.id : null);
                    if (next) onSelect(stopIndex);
                  }}
                >
                  <Popover.Trigger className={nameClass(active)}>{name}</Popover.Trigger>
                  <Popover.Portal>
                    <Popover.Positioner side="right" align="start" sideOffset={8} collisionPadding={12} className="z-50">
                      <Popover.Popup className="max-h-[min(70vh,26rem)] w-72 overflow-y-auto rounded-xl border bg-card p-3 text-sm text-card-foreground shadow-lg outline-none">
                        {details}
                      </Popover.Popup>
                    </Popover.Positioner>
                  </Popover.Portal>
                </Popover.Root>
              )}
            </div>
            {narrow && open ? <div className="mt-1 mb-2 rounded-xl border bg-card p-3 text-sm">{details}</div> : null}
          </li>
        );
      })}
    </ol>
  );
}
