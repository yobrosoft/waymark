"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { publicAsset } from "@/lib/base-path";
import { MAP_STYLE_URL } from "@/lib/providers";
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
  onSelectLocation: (locationId: string) => void;
}

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

function lineData(line: LineStringGeometry | null): GeoJSON.Feature | GeoJSON.FeatureCollection {
  if (!line) return EMPTY;
  return { type: "Feature", properties: {}, geometry: line };
}

export function TripMap({ places, line, mode, nearby, camera, onSelectLocation }: TripMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const onSelectRef = useRef(onSelectLocation);
  onSelectRef.current = onSelectLocation;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    setReady(false);
    maplibregl.setWorkerUrl(publicAsset("/maplibre-gl-worker.js"));
    const map = new maplibregl.Map({
      container,
      style: MAP_STYLE_URL,
      center: [100.746861, 13.681895],
      zoom: 12.5,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      minZoom: 2,
      maxZoom: 18,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric", maxWidth: 120 }), "bottom-left");
    const compact = window.matchMedia("(max-width: 800px)").matches;
    map.addControl(new maplibregl.AttributionControl({ compact }), "bottom-right");
    mapRef.current = map;
    let settled = false;
    const timer = window.setTimeout(() => {
      if (!settled) {
        setProblem("The street map did not load. No drawn substitute was added.");
      }
    }, 12000);
    map.on("load", () => {
      settled = true;
      window.clearTimeout(timer);
      map.addSource("leg", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "leg-casing",
        type: "line",
        source: "leg",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#1c1915", "line-width": 9, "line-opacity": 0.28 },
      });
      map.addLayer({
        id: "leg-solid",
        type: "line",
        source: "leg",
        layout: { "line-cap": "round", "line-join": "round", visibility: "none" },
        paint: { "line-color": "#c4563a", "line-width": 5 },
      });
      map.addLayer({
        id: "leg-dash",
        type: "line",
        source: "leg",
        layout: { "line-cap": "round", "line-join": "round", visibility: "none" },
        paint: { "line-color": "#1f4d4a", "line-width": 5, "line-dasharray": [1.2, 1.15] },
      });
      setProblem(null);
      setReady(true);
    });
    map.on("error", (event) => {
      const message = event.error?.message ?? "";
      if (!settled && /fetch|style|ajax|network|failed/i.test(message)) {
        setProblem("The street map failed to load. No substitute map was drawn.");
      }
    });
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(container);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, [attempt]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource("leg") as maplibregl.GeoJSONSource | undefined;
    if (!source || source.type !== "geojson") return;
    source.setData(lineData(line));
    const dashed = mode !== "driving";
    const color = mode === "walking" ? "#1f4d4a" : mode === "cycling" ? "#a56b12" : "#c4563a";
    map.setLayoutProperty("leg-solid", "visibility", line && !dashed ? "visible" : "none");
    map.setLayoutProperty("leg-dash", "visibility", line && dashed ? "visible" : "none");
    map.setPaintProperty(dashed ? "leg-dash" : "leg-solid", "line-color", color);
  }, [line, mode, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    markersRef.current.forEach((marker) => marker.remove());
    const next: maplibregl.Marker[] = [];
    for (const place of places) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `waymark-pin${place.selected ? " is-selected" : ""}`;
      button.style.setProperty("--pin", place.color);
      button.textContent = place.badge;
      button.setAttribute("aria-label", place.aria);
      button.addEventListener("click", () => onSelectRef.current(place.locationId));
      next.push(
        new maplibregl.Marker({ element: button, anchor: "bottom" })
          .setLngLat([place.lon, place.lat])
          .addTo(map),
      );
    }
    for (const place of nearby) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "waymark-dot";
      button.setAttribute("aria-label", `${place.name}, ${place.kind}`);
      button.addEventListener("click", () => {
        new maplibregl.Popup({ offset: 12, closeButton: true })
          .setLngLat([place.lon, place.lat])
          .setHTML(
            `<strong>${escapeHtml(place.name)}</strong><br/><span>${escapeHtml(place.kind)} · ${place.straightLineMeters} m straight-line</span>`,
          )
          .addTo(map);
      });
      next.push(
        new maplibregl.Marker({ element: button, anchor: "center" })
          .setLngLat([place.lon, place.lat])
          .addTo(map),
      );
    }
    markersRef.current = next;
  }, [places, nearby, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !camera) return;
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 750;
    if (camera.type === "point") {
      map.flyTo({ center: [camera.lon, camera.lat], zoom: camera.zoom, duration, essential: true });
      return;
    }
    if (camera.points.length === 0) return;
    const bounds = new maplibregl.LngLatBounds(camera.points[0], camera.points[0]);
    for (const point of camera.points) bounds.extend(point);
    map.fitBounds(bounds, {
      padding: { top: 56, right: 48, bottom: 56, left: 48 },
      duration,
      maxZoom: camera.maxZoom ?? 15,
      essential: true,
    });
  }, [camera, ready]);

  return (
    <div className="relative h-full min-h-64">
      <div ref={containerRef} className="h-full w-full" role="application" aria-label="Street map" />
      {problem ? (
        <div className="absolute inset-x-3 top-3 z-20 rounded-xl border border-destructive/30 bg-card p-3 text-sm shadow-lg">
          <p className="font-medium text-destructive">Basemap unavailable</p>
          <p className="mt-1 text-muted-foreground">{problem}</p>
          <button
            type="button"
            className="mt-2 text-sm font-medium text-primary underline"
            onClick={() => {
              setProblem(null);
              setAttempt((value) => value + 1);
            }}
          >
            Try the street map again
          </button>
        </div>
      ) : null}
    </div>
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
