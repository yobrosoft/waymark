# Waymark API

Go service for accounts, trips, share links, and the MCP endpoint an agent uses.

The TypeScript app stays in the repository root. This process is the backend.

## Where it runs

Vercel can run a Go HTTP server, and the free plan is enough for a small function. It is a poor fit for this service. The repository root is the Next.js app, Vercel no longer has its own database, and a marketplace Postgres is a second system to run. Trip documents are small JSON files that several people may open.

Use Google Cloud Run for the Go process and Firestore for the documents. Both have a free tier that covers a personal travel book: Cloud Run scales to zero, and Firestore’s free quota is 1 GiB with tens of thousands of reads and writes a day. No database server to patch.

SQLite is the local store so the service runs with one file. Do not use that file on Cloud Run. A restart would drop the trips. Set `WAYMARK_FIRESTORE_PROJECT` to the Google Cloud project id and the process uses Firestore instead. The client also honors `FIRESTORE_EMULATOR_HOST`.

On Cloud Run, give the service account Cloud Datastore User, and set:

```text
WAYMARK_FIRESTORE_PROJECT=your-project
WAYMARK_PUBLIC_ORIGIN=https://your-service-url
WAYMARK_ALLOW_SIGNUP=false
WAYMARK_UI_ORIGINS=https://your-app
```

`PORT` is set by Cloud Run. From `backend/`, `gcloud run deploy waymark-api --source .` builds the Go module.

## Run locally

```bash
cd backend
go run ./cmd/waymark
```

The API listens on `127.0.0.1:8795`. The database file is `~/.local/share/waymark/waymark.db`.

Sign in with Google. Set `WAYMARK_GOOGLE_CLIENT_ID` and `WAYMARK_GOOGLE_CLIENT_SECRET` from a web OAuth client. The app posts the Google ID token to `POST /v1/sessions` and keeps the session itself. The Grok consent page uses the same Google account. The first sign-in creates the Waymark account.

A name-and-token account still works for a local curl, and on the consent page under “Use an existing account token”:

```bash
curl -s -X POST http://127.0.0.1:8795/v1/accounts \
  -H 'content-type: application/json' \
  -d '{"name":"Joel"}'
```

`POST /v1/trips` and `PUT /v1/trips/{id}` take `{ "trip": { ...version 1 trip... } }` and `Authorization: Bearer <token>`. `POST /v1/trips/{id}/shares` returns a view link. `GET /v1/shared/{token}` does not need an account.

MCP is `POST /mcp`. Tools are `list_trips`, `get_trip`, `create_trip`, and `update_trip`. An update replaces the saved trip.

For a Grok connector, set `WAYMARK_PUBLIC_ORIGIN` to the public origin. Discovery is `/.well-known/oauth-authorization-server`. Client id `grok`, empty secret, scope `waymark:plan`. The consent page is “Continue with Google”.

Set `WAYMARK_ALLOW_SIGNUP=false` to keep new Google accounts from being created. Set `WAYMARK_UI_ORIGINS` to the app origins that may call the API. The app reads `googleClientId` from `/config.json`.
