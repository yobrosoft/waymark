"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GOOGLE_MAPS_KEY_URL } from "@/lib/providers";
import { classifyPlace, placeIconSvg } from "@/lib/place-kind";
import type { MapPlace } from "@/lib/trip-logic";
import type { LegMode, LineStringGeometry, NearbyPlace } from "@/lib/types";

export type CameraSpec =
  | { type: "point"; lon: number; lat: number; zoom: number }
  | { type: "bounds"; points: [number, number][]; maxZoom?: number };

export type Camera = CameraSpec & { id: number };

interface TripMapProps {
  places: MapPlace[];
  line: LineStringGeometry | null;
  mode: LegMode;
  nearby: NearbyPlace[];
  camera: Camera | null;
  night: boolean;
  onSelectLocation: (locationId: string) => void;
}

const NIGHT_STYLES: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#1c1c1e" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#f2f2f7" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#1c1c1e" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#2c2c2e" }] },
  { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: "#3a3a3c" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#48484a" }] },
  { featureType: "poi", elementType: "geometry", stylers: [{ color: "#2c2c2e" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#1e3a2f" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0b2545" }] },
  { featureType: "transit", elementType: "geometry", stylers: [{ color: "#2c2c2e" }] },
];

const KEY_STORAGE = "waymark-google-maps-key";
const ENV_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() ?? "";

const MODE_COLOR: Record<LegMode, string> = {
  driving: "#007aff",
  walking: "#34c759",
  cycling: "#ff9500",
};

declare global {
  interface Window {
    gm_authFailure?: () => void;
  }
}

function readStoredKey(): string {
  try {
    return window.localStorage.getItem(KEY_STORAGE)?.trim() ?? "";
  } catch {
    return "";
  }
}

function linePath(line: LineStringGeometry): google.maps.LatLngLiteral[] {
  return line.coordinates.map(([lon, lat]) => ({ lat, lng: lon }));
}

function applyLine(
  casing: google.maps.Polyline,
  stroke: google.maps.Polyline,
  line: LineStringGeometry | null,
  mode: LegMode,
  night: boolean,
) {
  if (!line) {
    casing.setPath([]);
    stroke.setPath([]);
    casing.setVisible(false);
    stroke.setVisible(false);
    return;
  }
  const path = linePath(line);
  const color = MODE_COLOR[mode] ?? MODE_COLOR.driving;
  const dashed = mode !== "driving";
  casing.setPath(path);
  stroke.setPath(path);
  casing.setOptions({
    strokeColor: night ? "#f2f2f7" : "#1c1c1e",
    strokeOpacity: night ? 0.45 : 0.28,
    strokeWeight: 9,
    visible: true,
    zIndex: 1,
  });
  stroke.setOptions(
    dashed
      ? {
          strokeOpacity: 0,
          strokeWeight: 5,
          visible: true,
          zIndex: 2,
          icons: [
            {
              icon: { path: "M 0,-1 0,1", strokeOpacity: 1, strokeColor: color, scale: 3 },
              offset: "0",
              repeat: "14px",
            },
          ],
        }
      : { strokeColor: color, strokeOpacity: 1, strokeWeight: 5, visible: true, zIndex: 2, icons: [] },
  );
}

export function TripMap({ places, line, mode, nearby, camera, night, onSelectLocation }: TripMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const casingRef = useRef<google.maps.Polyline | null>(null);
  const strokeRef = useRef<google.maps.Polyline | null>(null);
  const infoRef = useRef<google.maps.InfoWindow | null>(null);
  const markersRef = useRef<google.maps.OverlayView[]>([]);
  const overlayCtor = useRef<
    | (new (position: google.maps.LatLngLiteral, wrapper: HTMLElement) => google.maps.OverlayView)
    | null
  >(null);
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [storedKey, setStoredKey] = useState("");
  const [hostedKey, setHostedKey] = useState("");
  const [configReady, setConfigReady] = useState(Boolean(ENV_KEY));
  const [draftKey, setDraftKey] = useState("");
  const [keyNote, setKeyNote] = useState<string | null>(null);
  const onSelectRef = useRef(onSelectLocation);
  onSelectRef.current = onSelectLocation;
  const key = ENV_KEY || hostedKey || storedKey;

  useEffect(() => {
    setStoredKey(readStoredKey());
    if (ENV_KEY) return;
    let cancel = false;
    fetch("/config.json", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { mapsKey?: unknown } | null) => {
        if (cancel) return;
        const value = typeof body?.mapsKey === "string" ? body.mapsKey.trim() : "";
        if (value) setHostedKey(value);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancel) setConfigReady(true);
      });
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !key) return;
    setReady(false);
    setProblem(null);
    let cancelled = false;
    let settled = false;
    const timer = window.setTimeout(() => {
      if (!cancelled && !settled) {
        setProblem("Google Maps did not load. No drawn substitute was added.");
      }
    }, 12000);
    const previousAuthFailure = window.gm_authFailure;
    window.gm_authFailure = () => {
      if (cancelled) return;
      settled = true;
      window.clearTimeout(timer);
      setReady(false);
      setProblem("Google Maps rejected this API key. Enable the Maps JavaScript API, and allow this page’s address on the key.");
    };

    void (async () => {
      try {
        setOptions({ key, v: "weekly" });
        const { Map } = await importLibrary("maps");
        if (cancelled) return;
        const map = new Map(container, {
          center: { lat: 13.681895, lng: 100.746861 },
          zoom: 12.5,
          minZoom: 2,
          maxZoom: 20,
          clickableIcons: true,
          gestureHandling: "greedy",
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          zoomControl: true,
          scaleControl: true,
          rotateControl: false,
          tilt: 0,
        });
        const casing = new google.maps.Polyline({ map, clickable: false });
        const stroke = new google.maps.Polyline({ map, clickable: false });
        class HtmlOverlay extends google.maps.OverlayView {
          private readonly latLng: google.maps.LatLng;
          constructor(
            position: google.maps.LatLngLiteral,
            private readonly wrapper: HTMLElement,
          ) {
            super();
            this.latLng = new google.maps.LatLng(position);
          }
          onAdd() {
            this.getPanes()?.overlayMouseTarget.appendChild(this.wrapper);
          }
          draw() {
            const point = this.getProjection()?.fromLatLngToDivPixel(this.latLng);
            if (!point) return;
            this.wrapper.style.left = `${point.x}px`;
            this.wrapper.style.top = `${point.y}px`;
          }
          onRemove() {
            this.wrapper.remove();
          }
        }
        const compactPins = () => {
          const zoom = map.getZoom() ?? 0;
          container.classList.toggle("is-compact", zoom < 13);
        };
        map.addListener("zoom_changed", compactPins);
        map.addListener("idle", compactPins);
        compactPins();
        mapRef.current = map;
        casingRef.current = casing;
        strokeRef.current = stroke;
        infoRef.current = new google.maps.InfoWindow();
        overlayCtor.current = HtmlOverlay;
        settled = true;
        window.clearTimeout(timer);
        setProblem(null);
        setReady(true);
      } catch (error) {
        if (cancelled) return;
        settled = true;
        window.clearTimeout(timer);
        const message = error instanceof Error ? error.message : "Google Maps did not load.";
        setProblem(`${message} No substitute map was drawn.`);
      }
    })();

    const observer = new ResizeObserver(() => {
      const map = mapRef.current;
      if (map) google.maps.event.trigger(map, "resize");
    });
    observer.observe(container);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.gm_authFailure = previousAuthFailure;
      observer.disconnect();
      markersRef.current.forEach((marker) => marker.setMap(null));
      markersRef.current = [];
      const map = mapRef.current;
      if (map) google.maps.event.clearInstanceListeners(map);
      casingRef.current?.setMap(null);
      strokeRef.current?.setMap(null);
      infoRef.current?.close();
      casingRef.current = null;
      strokeRef.current = null;
      infoRef.current = null;
      overlayCtor.current = null;
      mapRef.current = null;
      container.replaceChildren();
      setReady(false);
    };
  }, [attempt, key]);

  useEffect(() => {
    const casing = casingRef.current;
    const stroke = strokeRef.current;
    if (!casing || !stroke || !ready) return;
    applyLine(casing, stroke, line, mode, night);
  }, [line, mode, night, ready]);

  useEffect(() => {
    const map = mapRef.current;
    const Ctor = overlayCtor.current;
    if (!map || !Ctor || !ready) return;
    markersRef.current.forEach((marker) => marker.setMap(null));
    infoRef.current?.close();
    const next: google.maps.OverlayView[] = [];
    for (const place of places) {
      const wrapper = document.createElement("div");
      wrapper.className = "waymark-marker";
      wrapper.dataset.anchor = "bottom";
      wrapper.style.zIndex = place.selected ? "4" : "1";
      const button = document.createElement("button");
      button.type = "button";
      button.className = `waymark-pin${place.selected ? " is-selected" : ""}`;
      button.style.setProperty("--pin", place.color);
      button.title = `${place.kindLabel} · ${place.name}`;
      button.setAttribute("aria-label", place.aria);
      const body = document.createElement("span");
      body.className = "waymark-pin-body";
      const icon = document.createElement("span");
      icon.className = "waymark-pin-icon";
      icon.innerHTML = placeIconSvg(place.kind);
      const number = document.createElement("span");
      number.className = "waymark-pin-num";
      number.textContent = place.badge;
      const name = document.createElement("span");
      name.className = "waymark-pin-name";
      name.textContent = place.name;
      body.append(icon, number, name);
      const tail = document.createElement("span");
      tail.className = "waymark-pin-tail";
      tail.setAttribute("aria-hidden", "true");
      button.append(body, tail);
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        onSelectRef.current(place.locationId);
      });
      wrapper.append(button);
      const marker = new Ctor({ lat: place.lat, lng: place.lon }, wrapper);
      marker.setMap(map);
      next.push(marker);
    }
    for (const place of nearby) {
      const wrapper = document.createElement("div");
      wrapper.className = "waymark-marker";
      wrapper.dataset.anchor = "center";
      const button = document.createElement("button");
      button.type = "button";
      const nearbyKind = classifyPlace({ name: place.kind.replaceAll("_", " ") });
      button.className = "waymark-dot";
      button.innerHTML = placeIconSvg(nearbyKind);
      button.setAttribute("aria-label", `${place.name}, ${place.kind}`);
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const info = infoRef.current;
        if (!info) return;
        const content = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = place.name;
        const detail = document.createElement("div");
        detail.textContent = `${place.kind} · ${place.straightLineMeters} m straight-line`;
        content.append(title, detail);
        info.setContent(content);
        info.setPosition({ lat: place.lat, lng: place.lon });
        info.open({ map });
      });
      wrapper.append(button);
      const marker = new Ctor({ lat: place.lat, lng: place.lon }, wrapper);
      marker.setMap(map);
      next.push(marker);
    }
    markersRef.current = next;
  }, [places, nearby, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !camera) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (camera.type === "point") {
      const center = { lat: camera.lat, lng: camera.lon };
      if (reduce) map.setCenter(center);
      else map.panTo(center);
      map.setZoom(camera.zoom);
      return;
    }
    if (camera.points.length === 0) return;
    const bounds = new google.maps.LatLngBounds();
    for (const [lon, lat] of camera.points) bounds.extend({ lat, lng: lon });
    map.fitBounds(bounds, { top: 64, right: 72, bottom: 56, left: 48 });
    const maxZoom = camera.maxZoom ?? 15;
    google.maps.event.addListenerOnce(map, "bounds_changed", () => {
      const zoom = map.getZoom();
      if (zoom != null && zoom > maxZoom) map.setZoom(maxZoom);
    });
  }, [camera, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setOptions({ colorScheme: night ? "DARK" : "LIGHT", styles: night ? NIGHT_STYLES : [] });
  }, [night, ready]);

  function saveKey(event: FormEvent) {
    event.preventDefault();
    const next = draftKey.trim();
    if (!next) {
      setKeyNote("Paste the API key first.");
      return;
    }
    try {
      window.localStorage.setItem(KEY_STORAGE, next);
    } catch {
      setKeyNote("This browser blocked local storage, so the key was not saved.");
      return;
    }
    setKeyNote(null);
    setDraftKey("");
    if (window.google?.maps) {
      window.location.reload();
      return;
    }
    setStoredKey(next);
  }

  function forgetKey() {
    try {
      window.localStorage.removeItem(KEY_STORAGE);
    } catch {
      // The form still returns if the stored value cannot be cleared.
    }
    if (window.google?.maps) {
      window.location.reload();
      return;
    }
    setStoredKey("");
    setProblem(null);
  }

  return (
    <div className="relative h-full min-h-64">
      <div ref={containerRef} className="waymark-map h-full w-full" role="application" aria-label="Google map" />
      {configReady && !key ? (
        <form
          className="absolute inset-0 z-20 grid place-items-center bg-background/85 p-4"
          onSubmit={saveKey}
        >
          <div className="grid w-full max-w-md gap-3 rounded-xl border bg-card p-4 shadow-lg">
            <div>
              <p className="font-medium">Google Maps needs an API key</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Restaurants, landmarks, and other places come from Google. Enable the Maps JavaScript API, create a
                browser key, and allow this site&apos;s address. The key stays in this browser.
              </p>
            </div>
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={draftKey}
              placeholder="Maps JavaScript API key"
              aria-label="Google Maps API key"
              onChange={(event) => setDraftKey(event.target.value)}
            />
            {keyNote ? <p className="text-sm text-destructive">{keyNote}</p> : null}
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit">Show the Google map</Button>
              <a className="text-sm underline" href={GOOGLE_MAPS_KEY_URL} target="_blank" rel="noreferrer">
                Create a key
              </a>
            </div>
          </div>
        </form>
      ) : null}
      {problem ? (
        <div className="absolute inset-x-3 top-3 z-20 rounded-xl border border-destructive/30 bg-card p-3 text-sm shadow-lg">
          <p className="font-medium text-destructive">Basemap unavailable</p>
          <p className="mt-1 text-muted-foreground">{problem}</p>
          <div className="mt-2 flex flex-wrap gap-3">
            <button
              type="button"
              className="text-sm font-medium text-primary underline"
              onClick={() => {
                setProblem(null);
                setAttempt((value) => value + 1);
              }}
            >
              Try Google Maps again
            </button>
            {ENV_KEY ? null : (
              <button type="button" className="text-sm font-medium text-primary underline" onClick={forgetKey}>
                Use a different key
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
