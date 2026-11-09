// Package api is the HTTP API the TypeScript app and the MCP endpoint share.
package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/yobrosoft/waymark/backend/internal/mcp"
	"github.com/yobrosoft/waymark/backend/internal/oauth"
	"github.com/yobrosoft/waymark/backend/internal/secret"
	"github.com/yobrosoft/waymark/backend/internal/store"
	"github.com/yobrosoft/waymark/backend/internal/trip"
)

// Server is the Waymark account API.
type Server struct {
	Store       store.Store
	Origin      string
	AllowSignup bool
	UIOrigins   map[string]struct{}
}

func (s Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	oauth.Handler{Store: s.Store, Origin: s.Origin}.Register(mux)
	mux.Handle("POST /mcp", mcp.Handler{Store: s.Store, Origin: s.Origin, Identify: s.user})
	mux.HandleFunc("POST /v1/accounts", s.createAccount)
	mux.HandleFunc("GET /v1/trips", s.listTrips)
	mux.HandleFunc("POST /v1/trips", s.createTrip)
	mux.HandleFunc("GET /v1/trips/{id}", s.getTrip)
	mux.HandleFunc("PUT /v1/trips/{id}", s.updateTrip)
	mux.HandleFunc("DELETE /v1/trips/{id}", s.deleteTrip)
	mux.HandleFunc("POST /v1/trips/{id}/shares", s.createShare)
	mux.HandleFunc("GET /v1/shared/{token}", s.sharedTrip)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.cors(w, r)
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		mux.ServeHTTP(w, r)
	})
}

func (s Server) createAccount(w http.ResponseWriter, r *http.Request) {
	if !s.AllowSignup {
		writeErr(w, http.StatusForbidden, "Account signup is turned off.", nil)
		return
	}
	var body struct {
		Name string `json:"name"`
	}
	if err := decode(w, r, &body); err != nil || strings.TrimSpace(body.Name) == "" || len(body.Name) > 80 {
		writeErr(w, http.StatusBadRequest, "Give the account a name of 1 to 80 characters.", nil)
		return
	}
	token, err := secret.New("wm_", 32)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "The account was not created.", nil)
		return
	}
	user, err := s.Store.CreateUser(r.Context(), strings.TrimSpace(body.Name), secret.Hash(token))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "The account was not created.", nil)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"ok": true, "id": user.ID, "name": user.Name, "token": token})
}

func (s Server) listTrips(w http.ResponseWriter, r *http.Request) {
	user, ok := s.user(r)
	if !ok {
		writeErr(w, http.StatusUnauthorized, "Sign in with a Waymark account token.", nil)
		return
	}
	items, err := s.Store.ListTrips(r.Context(), user.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "The trip list could not be read.", nil)
		return
	}
	if items == nil {
		items = []trip.Summary{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "trips": items})
}

func (s Server) createTrip(w http.ResponseWriter, r *http.Request) {
	user, ok := s.user(r)
	if !ok {
		writeErr(w, http.StatusUnauthorized, "Sign in with a Waymark account token.", nil)
		return
	}
	item, issues, code := s.readTrip(w, r, "")
	if code != 0 {
		writeErr(w, code, "The trip was not saved.", issues)
		return
	}
	if err := s.Store.CreateTrip(r.Context(), user.ID, item); err != nil {
		if errors.Is(err, store.ErrConflict) {
			writeErr(w, http.StatusConflict, "A trip with that id already exists.", nil)
			return
		}
		writeErr(w, http.StatusInternalServerError, "The trip was not saved.", nil)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"ok": true, "trip": item})
}

func (s Server) getTrip(w http.ResponseWriter, r *http.Request) {
	user, ok := s.user(r)
	if !ok {
		writeErr(w, http.StatusUnauthorized, "Sign in with a Waymark account token.", nil)
		return
	}
	owner, item, err := s.Store.GetTrip(r.Context(), r.PathValue("id"))
	if err != nil || owner != user.ID {
		writeErr(w, http.StatusNotFound, "That trip was not found in this account.", nil)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "trip": item})
}

func (s Server) updateTrip(w http.ResponseWriter, r *http.Request) {
	user, ok := s.user(r)
	if !ok {
		writeErr(w, http.StatusUnauthorized, "Sign in with a Waymark account token.", nil)
		return
	}
	id := r.PathValue("id")
	item, issues, code := s.readTrip(w, r, id)
	if code != 0 {
		writeErr(w, code, "The trip was not saved.", issues)
		return
	}
	if err := s.Store.UpdateTrip(r.Context(), user.ID, item); err != nil {
		if errors.Is(err, store.ErrNotFound) || errors.Is(err, store.ErrForbidden) {
			writeErr(w, http.StatusNotFound, "That trip was not found in this account.", nil)
			return
		}
		writeErr(w, http.StatusInternalServerError, "The trip was not saved.", nil)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "trip": item})
}

func (s Server) deleteTrip(w http.ResponseWriter, r *http.Request) {
	user, ok := s.user(r)
	if !ok {
		writeErr(w, http.StatusUnauthorized, "Sign in with a Waymark account token.", nil)
		return
	}
	err := s.Store.DeleteTrip(r.Context(), user.ID, r.PathValue("id"))
	if err != nil {
		if errors.Is(err, store.ErrNotFound) || errors.Is(err, store.ErrForbidden) {
			writeErr(w, http.StatusNotFound, "That trip was not found in this account.", nil)
			return
		}
		writeErr(w, http.StatusInternalServerError, "The trip was not deleted.", nil)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s Server) createShare(w http.ResponseWriter, r *http.Request) {
	user, ok := s.user(r)
	if !ok {
		writeErr(w, http.StatusUnauthorized, "Sign in with a Waymark account token.", nil)
		return
	}
	token, err := secret.New("", 24)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "The share link was not created.", nil)
		return
	}
	share, err := s.Store.CreateShare(r.Context(), user.ID, r.PathValue("id"), token)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) || errors.Is(err, store.ErrForbidden) {
			writeErr(w, http.StatusNotFound, "That trip was not found in this account.", nil)
			return
		}
		writeErr(w, http.StatusInternalServerError, "The share link was not created.", nil)
		return
	}
	path := "/v1/shared/" + share.Token
	body := map[string]any{"ok": true, "token": share.Token, "role": share.Role, "path": path}
	if s.Origin != "" {
		body["url"] = strings.TrimRight(s.Origin, "/") + path
	}
	writeJSON(w, http.StatusCreated, body)
}

func (s Server) sharedTrip(w http.ResponseWriter, r *http.Request) {
	item, err := s.Store.TripByShare(r.Context(), r.PathValue("token"))
	if err != nil {
		writeErr(w, http.StatusNotFound, "This share link does not match a trip.", nil)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "role": "view", "trip": item})
}

func (s Server) readTrip(w http.ResponseWriter, r *http.Request, mustID string) (trip.Trip, []string, int) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if err != nil {
		return trip.Trip{}, nil, http.StatusBadRequest
	}
	var envelope struct {
		Trip json.RawMessage `json:"trip"`
	}
	raw := body
	if err := json.Unmarshal(body, &envelope); err == nil && len(envelope.Trip) > 0 {
		raw = envelope.Trip
	}
	item, err := trip.Parse(raw)
	if err != nil {
		return trip.Trip{}, []string{"The trip was not valid JSON."}, http.StatusBadRequest
	}
	if mustID != "" && item.ID != mustID {
		return trip.Trip{}, []string{"The trip id does not match the URL."}, http.StatusBadRequest
	}
	now := time.Now().UTC().Format(time.RFC3339)
	if item.CreatedAt == "" {
		item.CreatedAt = now
	}
	item.UpdatedAt = now
	if issues := trip.Validate(item); len(issues) > 0 {
		return trip.Trip{}, issues, http.StatusBadRequest
	}
	return item, nil, 0
}

func (s Server) user(r *http.Request) (store.User, bool) {
	token := bearer(r.Header.Get("Authorization"))
	if token == "" {
		return store.User{}, false
	}
	hash := secret.Hash(token)
	if user, err := s.Store.UserByTokenHash(r.Context(), hash); err == nil {
		return user, true
	}
	if user, err := s.Store.UserByAccessHash(r.Context(), hash); err == nil {
		return user, true
	}
	return store.User{}, false
}

func (s Server) cors(w http.ResponseWriter, r *http.Request) {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return
	}
	if _, ok := s.UIOrigins[origin]; !ok {
		return
	}
	w.Header().Set("Access-Control-Allow-Origin", origin)
	w.Header().Set("Vary", "Origin")
	w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
}

func bearer(header string) string {
	const prefix = "Bearer "
	if len(header) < len(prefix) || !strings.EqualFold(header[:len(prefix)], prefix) {
		return ""
	}
	return strings.TrimSpace(header[len(prefix):])
}

func decode(w http.ResponseWriter, r *http.Request, dest any) error {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<14))
	dec.DisallowUnknownFields()
	return dec.Decode(dest)
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeErr(w http.ResponseWriter, status int, message string, issues []string) {
	if issues == nil {
		issues = []string{}
	}
	writeJSON(w, status, map[string]any{"ok": false, "error": message, "issues": issues})
}
