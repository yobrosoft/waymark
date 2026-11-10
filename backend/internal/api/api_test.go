package api_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"html"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"

	"github.com/yobrosoft/waymark/backend/internal/api"
	"github.com/yobrosoft/waymark/backend/internal/googleauth"
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

func TestGoogleSignInAndConsent(t *testing.T) {
	db, err := sqlite.Open(filepath.Join(t.TempDir(), "waymark.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	verify := func(_ context.Context, raw string) (googleauth.Profile, error) {
		if raw != "id-token" {
			return googleauth.Profile{}, errors.New("bad token")
		}
		return googleauth.Profile{Sub: "google-sub", Email: "Joel@Example.com", Name: "Joel", EmailVerified: true}, nil
	}
	exchange := func(_ context.Context, code, redirectURI string) (string, error) {
		if code != "auth-code" || redirectURI != "http://127.0.0.1:8795/oauth/google/callback" {
			return "", errors.New("bad code")
		}
		return "id-token", nil
	}
	handler := api.Server{
		Store: db, Origin: "http://127.0.0.1:8795", AllowSignup: true,
		GoogleID: "client", GoogleSecret: "secret", Verify: verify, Exchange: exchange,
	}.Handler()

	missing := call(t, api.Server{Store: db, Origin: "http://127.0.0.1:8795", AllowSignup: true}.Handler(), http.MethodPost, "/v1/sessions", "", map[string]any{"credential": "id-token"})
	if missing.Code != http.StatusNotFound {
		t.Fatalf("unconfigured %d", missing.Code)
	}

	first := call(t, handler, http.MethodPost, "/v1/sessions", "", map[string]any{"credential": "id-token"})
	if first.Code != http.StatusCreated {
		t.Fatalf("session %d %s", first.Code, first.Body.String())
	}
	var opened struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal(first.Body.Bytes(), &opened); err != nil || !strings.HasPrefix(opened.Token, "wm_") {
		t.Fatalf("token %s", first.Body.String())
	}
	created := call(t, handler, http.MethodPost, "/v1/trips", opened.Token, map[string]any{"trip": sampleTrip("trip-one")})
	if created.Code != http.StatusCreated {
		t.Fatalf("create %d %s", created.Code, created.Body.String())
	}
	second := call(t, handler, http.MethodPost, "/v1/sessions", "", map[string]any{"credential": "id-token"})
	var again struct {
		Token string `json:"token"`
	}
	if second.Code != http.StatusCreated || json.Unmarshal(second.Body.Bytes(), &again) != nil {
		t.Fatalf("second session %d %s", second.Code, second.Body.String())
	}
	seen := call(t, handler, http.MethodGet, "/v1/trips/trip-one", again.Token, nil)
	if seen.Code != http.StatusOK {
		t.Fatalf("same google account %d", seen.Code)
	}

	closed := api.Server{
		Store: db, Origin: "http://127.0.0.1:8795", AllowSignup: false,
		GoogleID: "client", GoogleSecret: "secret",
		Verify: func(context.Context, string) (googleauth.Profile, error) {
			return googleauth.Profile{Sub: "someone-else", Email: "new@example.com", Name: "New", EmailVerified: true}, nil
		},
	}.Handler()
	rejected := call(t, closed, http.MethodPost, "/v1/sessions", "", map[string]any{"credential": "id-token"})
	if rejected.Code != http.StatusForbidden {
		t.Fatalf("signup off %d %s", rejected.Code, rejected.Body.String())
	}

	verifier := strings.Repeat("b", 48)
	sum := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(sum[:])
	query := url.Values{
		"response_type":         {"code"},
		"client_id":             {"grok"},
		"redirect_uri":          {"https://grok.com/connectors-oauth-exchange-code"},
		"state":                 {"xyz"},
		"code_challenge":        {challenge},
		"code_challenge_method": {"S256"},
		"scope":                 {"waymark:plan"},
	}
	page := call(t, handler, http.MethodGet, "/oauth/authorize?"+query.Encode(), "", nil)
	if page.Code != http.StatusOK || !strings.Contains(page.Body.String(), "Continue with Google") {
		t.Fatalf("consent %d %s", page.Code, page.Body.String())
	}
	unescaped := html.UnescapeString(page.Body.String())
	start := strings.Index(unescaped, "https://accounts.google.com/")
	if start < 0 {
		t.Fatalf("google url %s", unescaped)
	}
	end := strings.Index(unescaped[start:], `"`)
	googleURL, err := url.Parse(unescaped[start : start+end])
	if err != nil || end < 0 {
		t.Fatalf("google url %s", unescaped)
	}
	if googleURL.Query().Get("redirect_uri") != "http://127.0.0.1:8795/oauth/google/callback" {
		t.Fatalf("redirect %s", googleURL.Query().Get("redirect_uri"))
	}
	callback := call(t, handler, http.MethodGet, "/oauth/google/callback?code=auth-code&state="+url.QueryEscape(googleURL.Query().Get("state")), "", nil)
	if callback.Code != http.StatusFound {
		t.Fatalf("callback %d %s", callback.Code, callback.Body.String())
	}
	loc, err := url.Parse(callback.Header().Get("Location"))
	if err != nil || loc.Query().Get("state") != "xyz" || loc.Query().Get("code") == "" {
		t.Fatalf("redirect %s", callback.Header().Get("Location"))
	}
	token := form(t, handler, "/oauth/token", url.Values{
		"grant_type":    {"authorization_code"},
		"client_id":     {"grok"},
		"code":          {loc.Query().Get("code")},
		"redirect_uri":  {"https://grok.com/connectors-oauth-exchange-code"},
		"code_verifier": {verifier},
	})
	if token.Code != http.StatusOK {
		t.Fatalf("token %d %s", token.Code, token.Body.String())
	}
	var granted struct {
		Access string `json:"access_token"`
	}
	if err := json.Unmarshal(token.Body.Bytes(), &granted); err != nil || granted.Access == "" {
		t.Fatal(token.Body.String())
	}
	listed := mcp(t, handler, granted.Access, "tools/call", map[string]any{"name": "list_trips", "arguments": map[string]any{}})
	if !strings.Contains(listed, "trip-one") {
		t.Fatalf("mcp %s", listed)
	}
	bad := call(t, handler, http.MethodGet, "/oauth/google/callback?code=auth-code&state=tampered", "", nil)
	if bad.Code != http.StatusBadRequest {
		t.Fatalf("tampered state %d", bad.Code)
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

func form(t *testing.T, handler http.Handler, path string, values url.Values) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(values.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
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
