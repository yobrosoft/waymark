package api_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/yobrosoft/waymark/backend/internal/api"
	"github.com/yobrosoft/waymark/backend/internal/sqlite"
)

func TestAccountTripShareAndMCP(t *testing.T) {
	db, err := sqlite.Open(filepath.Join(t.TempDir(), "waymark.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	handler := api.Server{
		Store:       db,
		Origin:      "http://127.0.0.1:8795",
		AllowSignup: true,
		UIOrigins:   map[string]struct{}{"http://127.0.0.1:3847": {}},
	}.Handler()

	owner := account(t, handler, "Joel")
	other := account(t, handler, "Sam")
	created := call(t, handler, http.MethodPost, "/v1/trips", owner.token, map[string]any{"trip": sampleTrip("trip-one")})
	if created.Code != http.StatusCreated {
		t.Fatalf("create %d %s", created.Code, created.Body.String())
	}

	hidden := call(t, handler, http.MethodGet, "/v1/trips/trip-one", other.token, nil)
	if hidden.Code != http.StatusNotFound {
		t.Fatalf("other account saw the trip: %d", hidden.Code)
	}

	updated := sampleTrip("trip-one")
	updated["name"] = "Bangkok, revised"
	put := call(t, handler, http.MethodPut, "/v1/trips/trip-one", owner.token, map[string]any{"trip": updated})
	if put.Code != http.StatusOK {
		t.Fatalf("update %d %s", put.Code, put.Body.String())
	}

	share := call(t, handler, http.MethodPost, "/v1/trips/trip-one/shares", owner.token, nil)
	if share.Code != http.StatusCreated {
		t.Fatalf("share %d %s", share.Code, share.Body.String())
	}
	var shared struct {
		Path string `json:"path"`
	}
	if err := json.Unmarshal(share.Body.Bytes(), &shared); err != nil {
		t.Fatal(err)
	}
	view := call(t, handler, http.MethodGet, shared.Path, "", nil)
	if view.Code != http.StatusOK || !strings.Contains(view.Body.String(), "Bangkok, revised") {
		t.Fatalf("shared view %d %s", view.Code, view.Body.String())
	}

	listed := mcp(t, handler, owner.token, "tools/call", map[string]any{
		"name":      "list_trips",
		"arguments": map[string]any{},
	})
	if !strings.Contains(listed, "trip-one") {
		t.Fatalf("mcp list %s", listed)
	}

	broken := sampleTrip("trip-bad")
	broken["stops"] = []any{map[string]any{"id": "s9", "locationId": "missing", "dayId": "d1", "plannedTime": "", "status": "proposed", "notes": "", "access": ""}}
	rejected := call(t, handler, http.MethodPost, "/v1/trips", owner.token, map[string]any{"trip": broken})
	if rejected.Code != http.StatusBadRequest || !strings.Contains(rejected.Body.String(), "unknown place") {
		t.Fatalf("broken trip %d %s", rejected.Code, rejected.Body.String())
	}

	removed := call(t, handler, http.MethodDelete, "/v1/trips/trip-one", owner.token, nil)
	if removed.Code != http.StatusOK {
		t.Fatalf("delete %d %s", removed.Code, removed.Body.String())
	}
	gone := call(t, handler, http.MethodGet, shared.Path, "", nil)
	if gone.Code != http.StatusNotFound {
		t.Fatalf("share survived delete: %d", gone.Code)
	}

	bad := call(t, handler, http.MethodPost, "/oauth/register", "", map[string]any{
		"redirect_uris": []string{"https://evil.example/steal"},
	})
	if bad.Code != http.StatusBadRequest {
		t.Fatalf("oauth register %d", bad.Code)
	}
}

func account(t *testing.T, handler http.Handler, name string) struct{ token string } {
	t.Helper()
	res := call(t, handler, http.MethodPost, "/v1/accounts", "", map[string]any{"name": name})
	if res.Code != http.StatusCreated {
		t.Fatalf("account %d %s", res.Code, res.Body.String())
	}
	var body struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &body); err != nil || body.Token == "" {
		t.Fatal(err)
	}
	return struct{ token string }{body.Token}
}

func call(t *testing.T, handler http.Handler, method, path, token string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(raw)
	}
	req := httptest.NewRequest(method, path, reader)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func mcp(t *testing.T, handler http.Handler, token, method string, params any) string {
	t.Helper()
	raw, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
	req := httptest.NewRequest(http.MethodPost, "/mcp", bytes.NewReader(raw))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("mcp %d %s", rec.Code, rec.Body.String())
	}
	return rec.Body.String()
}

func sampleTrip(id string) map[string]any {
	return map[string]any{
		"schemaVersion": 1,
		"id":            id,
		"name":          "Bangkok",
		"summary":       "A proposed week.",
		"timezone":      "Asia/Bangkok",
		"status":        "proposed",
		"days":          []any{map[string]any{"id": "d1", "date": "2026-12-08", "title": "Arrival", "notes": ""}},
		"locations":     []any{map[string]any{"id": "p1", "name": "Airport", "address": "", "lat": 13.68, "lon": 100.75, "pinNote": ""}},
		"stops":         []any{map[string]any{"id": "s1", "locationId": "p1", "dayId": "d1", "plannedTime": "Evening", "status": "proposed", "notes": "", "access": ""}},
		"legModes":      map[string]any{},
		"createdAt":     "2026-11-09T00:00:00Z",
		"updatedAt":     "2026-11-09T00:00:00Z",
	}
}
