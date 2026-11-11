# Waymark

A trip planner. The map is Google Maps, so restaurants, landmarks, and other places are Google's. The highlighted line is a road route from a public routing service, with that service's distance and typical time.

Signed in on the hosted app, trips are saved to the Waymark account. The same account is what a connected agent reads and updates, and a view link shares one trip. A local `npm run dev` without `NEXT_PUBLIC_WAYMARK_API_URL` keeps trips in this browser and does not upload them.

The sample trip is a **proposed** Bangkok sequence for 8–14 December 2026: 16 ordered stops at 8 places, starting at Suvarnabhumi. The hotel, flights, and restaurant tables in that sample are not bookings.

## Run locally

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:3847](http://127.0.0.1:3847).

Other scripts:

| Script | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server on port 3847 |
| `npm run build` | Static export at the site root (`out/`) |
| `npm run build:pages` | Static export for `https://<user>.github.io/waymark/` |
| `npm test` | Route-state, persistence, and import tests |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |

The map needs a Google Maps JavaScript API key. Paste it into the map, or set `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`. No other key is required to browse a trip.

To let Grok read a shared trip and send a suggestion back, run the Waymark MCP and set `NEXT_PUBLIC_WAYMARK_AGENT_URL` to its tailnet address. See [Grok on the tailnet](#grok-on-the-tailnet).

## What you can do

- Step **Next** and **Back** through the ordered stops. Arrow keys do the same when a text field is not focused.
- **Reset** returns to the first stop and frames the airport (or that trip's first pin).
- **Overview** frames every saved place. **Fit leg** frames the current road route, or the pin if there is no route.
- The day chips jump to the first stop on that day. A map pin jumps to the next visit of that place, then wraps.
- Drive, walk, and cycle use real routed geometry. Public transport uses Google's transit directions for that leg. Taxi and rideshare are not estimated.
- Time at a place is shown on the next pin, which is larger than the place you are leaving. A written window uses its longer end. A stay into the next day is overnight. Otherwise the time is a long estimate for that kind of place.
- Save several trips: create, edit, duplicate, delete (with confirmation), reorder stops, and edit coordinates or search for a place. On the hosted app those writes go to the account. Locally they stay in this browser.
- Export one trip or the whole library as JSON. Import validates the file before anything is written. Adding a file as new trips does not overwrite existing ones. Replacing same ids is a separate button.

Two hotel stops in the sample are same-place rest. Those legs do not request a route. Later visits to the hotel do.

## Where data lives

On the hosted app, trip names, notes, days, and stops are stored in the signed-in account. Sign in with the same Google account in another browser and they are there. An agent connected to that account reads and updates the same trips. A trip it saves appears in the open library within a few seconds. Share copies a view link for one trip.

A local run without `NEXT_PUBLIC_WAYMARK_API_URL` stores that document in **IndexedDB** in this browser profile (`waymark` / `library`). It is not synced and it is not uploaded. Clearing site data, or opening another browser or phone, starts from an empty book (the sample is added only when that store is empty). A reload does not put the sample back on top of edits. If the saved document is from a newer version or does not validate, Waymark leaves it untouched and offers a download.

The last stop you were viewing is a small `localStorage` preference. Losing it does not change the trip.

Export a JSON file when you want a portable backup.

## Map and routing providers

| Use | Provider | What is sent | Limit in this app |
| --- | --- | --- | --- |
| Basemap, labels, restaurants, landmarks | [Google Maps](https://developers.google.com/maps/documentation/javascript) JavaScript API | The current map view, from this browser, with the API key | Normal pan and zoom. Google’s logo stays on the map. |
| Drive, walk, cycle | [FOSSGIS OSRM](https://routing.openstreetmap.de/about.html) (`routing.openstreetmap.de`) | The two coordinates of the selected leg | About one upstream request per second. Successful routes are cached in this browser for 7 days. Not live traffic. Graphs are rebuilt about every two days. |
| Public transport | [Google Routes](https://developers.google.com/maps/documentation/routes) | The two coordinates and a departure time | One leg at a time. Scheduled time, not a live delay. About the next 100 days. |
| Address search | Not used | Nothing | Turned off. The public geocoder refuses browser requests. Enter coordinates instead. |
| Nearby food, cafes, pharmacy, shops, sights | Public [Overpass](https://wiki.openstreetmap.org/wiki/Overpass_API) (overpass-api.de, then overpass.kumi.systems if that instance is unavailable) | Pin coordinate and a 700 m category query | Slower queue. Cached 12 hours. Distances are straight-line, not travel times. |

If a service fails, the app says so. It does not draw a straight line or invent a duration. Same-place legs never call the router.

The browser calls those services directly. A successful route is cached in this browser. The route request does not include the trip. A signed-in account stores the trip separately.

Keep Google’s logo on the map, and keep the OSRM attribution. [Fix the map](https://www.openstreetmap.org/fixthemap) if a routed street is wrong. A wrong restaurant or landmark is Google’s data. The public routing server is a demo: do not scrape it or send a route for every stop at once. This app only asks for the leg you are looking at.

The basemap needs a Maps JavaScript API key. Paste it into the map pane (it stays in this browser’s local storage) or set `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` before `npm run dev` or `npm run build`. Enable **Maps JavaScript API** on the key, and restrict it by HTTP referrer (`http://127.0.0.1:3847/*` for this dev server). A key set at build time is visible in the static files. That is how this API works. Do not use a secret server key.

Google Maps links are external pages. Times on those pages are Google's. The driving and transit links ask Google to avoid ferries. The OSRM profile does not guarantee that. A transit leg on the map is also Google's, for the departure time shown with it.

Pins are facility, property, or complex points from the source notes. They are not a surveyed step-free entrance or an airport curb.

## JSON

Version 1 documents:

- A library: `{ "schemaVersion": 1, "kind": "waymark.library", "trips": [ ... ] }`
- A trip: `{ "schemaVersion": 1, "kind": "waymark.trip", "stops": [ ... ] }`

The JSON Schema is [`schema/waymark-library.schema.json`](schema/waymark-library.schema.json). Import also accepts a single trip or an array of trips. Files over 2 MB, broken JSON, unknown future versions, coordinates outside the valid range, and stops that point at missing places are rejected. Unknown keys are rejected. Nothing is written until you choose **Add as new trips** or **Replace trips with the same id**.

Shape, in short:

```text
Library
  trips[]
    days[]            calendar dates
    locations[]       reusable places (name, address, lat, lon, pin note)
    stops[]           ordered visits (day, place, planned time, status, notes, access)
    legModes{}        "fromStopId>toStopId" -> driving | walking | cycling | transit
```

Stop status `buffer` is a same-place rest. Trip status `proposed` means the plan is not confirmed.

## Account API

The Go service in `backend/` stores trips for an account, lets an agent create and update them over MCP, and issues a view link for someone else. People sign in with Google. The Grok consent page uses that same Google account, so there is no token to copy. Local runs use one SQLite file. The intended host is Cloud Run with Firestore, not the Vercel free plan. See [backend/README.md](backend/README.md).

## Grok on the tailnet

The MCP is a separate process, same shape as a small local connector. It listens on loopback only. One port is the public Grok connector. The other is the browser API, which you publish with Tailscale Serve so a phone or computer on your tailnet can open Waymark and see the suggestion. Do not put the browser port on Funnel. A suggestion is stored on this Mac and is not written into the browser until you apply it.

| Port | Who calls it | What it serves |
| --- | --- | --- |
| `127.0.0.1:8793` | Grok, through Funnel | `/mcp` and the OAuth consent flow. Scope `waymark:plan`. |
| `127.0.0.1:8794` | Waymark in the browser, through Tailscale Serve | `/api/agent/trips`. No bearer token. Tailnet membership is the lock. |

Tools are `list_trips`, `get_trip`, and `suggest_trip`. `suggest_trip` does not replace the saved trip. The app shows the summary and a map preview.

```bash
npm run mcp
```

Copy `deploy/waymark-mcp.secrets.env.example` to `~/.config/waymark-mcp/secrets.env`, mode `0600`. The bearer is what you paste on the consent page. It is not a Google key. Grants live in memory and drop when the process restarts. The shared trips live in `~/.local/share/waymark-mcp/sessions.json`.

In the Grok connector form, use client id `grok`, an empty secret, token auth method none, and scope `waymark:plan`. The server URL is `https://<your-machine>.<tailnet>.ts.net:10000/mcp` when Funnel sends port 10000 to `127.0.0.1:8793`.

## Publish the static site

The app is a static export. There is no Node server and no automatic deploy from the Origin repository to GitHub.

```bash
npm run build:pages
```

That writes `out/` with asset URLs under `/waymark`, a copy of the MapLibre worker, and `.nojekyll`. To check it locally, serve the parent of a `waymark` folder:

```bash
rm -rf /tmp/waymark-pages && mkdir -p /tmp/waymark-pages/waymark && cp -a out/. /tmp/waymark-pages/waymark/
npx --yes serve /tmp/waymark-pages -p 3847
```

Open `http://127.0.0.1:3847/waymark/`.

To publish, push **only the contents of `out/`** to the `gh-pages` branch of the public site repository. Do not push this source repository’s history there. In that repository’s Pages settings, choose **Deploy from a branch**, branch `gh-pages`, folder `/`. GitHub requires an admin with a verified email address to push that branch.

Drive, walk, and cycle requests go from the browser to the FOSSGIS OSRM demo. Nearby search calls public Overpass and shows a clear failure when those servers are busy. Address search is off. Nothing in the published files is a saved trip or a secret.

## Sample coordinates

Sourced for the proposed Bangkok trip, not surveyed entrances:

| Place | Latitude | Longitude |
| --- | --- | --- |
| Suvarnabhumi Airport (facility, not the pickup curb) | 13.681895 | 100.746861 |
| Chatrium Residence Sathon (proposed, not booked) | 13.702567 | 100.53755 |
| Wat Arun | 13.74361 | 100.48889 |
| ICONSIAM | 13.726694 | 100.510498 |
| CentralWorld | 13.746944 | 100.539719 |
| Asiatique The Riverfront | 13.706022 | 100.50466 |
| Supanniga Eating Room, Sathorn 10 | 13.723122 | 100.527273 |
| Baan Khanitha Sathorn | 13.7231005745 | 100.5364619293 |
