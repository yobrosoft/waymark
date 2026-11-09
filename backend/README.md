# Waymark API

Go service for accounts, trips, share links, and the MCP endpoint an agent uses.

The TypeScript app stays in the repository root. This process is the backend.

## Where it runs

Vercel can run a Go HTTP server, and the free plan is enough for a small function. It is a poor fit for this service. The repository root is the Next.js app, Vercel no longer has its own database, and a marketplace Postgres is a second system to run. Trip documents are small JSON files that several people may open.

Use Google Cloud Run for the Go process and Firestore for the documents. Both have a free tier that covers a personal travel book: Cloud Run scales to zero, and Firestore’s free quota is 1 GiB with tens of thousands of reads and writes a day. No database server to patch.

SQLite is the local store so the service runs with one file. Do not use that file on Cloud Run. A restart would drop the trips. The `store.Store` interface is what the Firestore adapter will implement.

## Run locally

```bash
cd backend
go run ./cmd/waymark
```

The API listens on `127.0.0.1:8795`. The database file is `~/.local/share/waymark/waymark.db`.

Create an account. The token is shown once. Give that token to the agent, or paste it on the MCP consent page.

```bash
curl -s -X POST http://127.0.0.1:8795/v1/accounts \
  -H 'content-type: application/json' \
  -d '{"name":"Joel"}'
```

`POST /v1/trips` and `PUT /v1/trips/{id}` take `{ "trip": { ...version 1 trip... } }` and `Authorization: Bearer <token>`. `POST /v1/trips/{id}/shares` returns a view link. `GET /v1/shared/{token}` does not need an account.

MCP is `POST /mcp`. Tools are `list_trips`, `get_trip`, `create_trip`, and `update_trip`. An update replaces the saved trip.

For a Grok connector, set `WAYMARK_PUBLIC_ORIGIN` to the public origin. Discovery is `/.well-known/oauth-authorization-server`. The consent page asks for the account token. Client id `grok`, empty secret, scope `waymark:plan`.

Set `WAYMARK_ALLOW_SIGNUP=false` on a public server until sign-in is more than a name. Set `WAYMARK_UI_ORIGINS` to the app origins that may call the API.
