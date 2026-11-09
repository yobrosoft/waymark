// Package mcp is the streamable HTTP endpoint an agent uses to read and change one person's trips.
package mcp

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/yobrosoft/waymark/backend/internal/store"
	"github.com/yobrosoft/waymark/backend/internal/trip"
)

const Scope = "waymark:plan"

const instructions = "Waymark stores trips for one person. list_trips shows their trips. get_trip returns one full trip. " +
	"create_trip and update_trip save a version 1 trip. Update replaces the saved trip, so send the full document. " +
	"The person reviews the same trip in the Waymark app and can share a view link. Do not invent bookings."

var tools = []map[string]any{
	{
		"name":        "list_trips",
		"description": "Trips in the signed-in person's account. Each item has id, name, status, timezone, and updatedAt.",
		"inputSchema": map[string]any{"type": "object", "properties": map[string]any{}, "additionalProperties": false},
	},
	{
		"name":        "get_trip",
		"description": "Read one trip the signed-in person owns.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"tripId": map[string]any{"type": "string"},
			},
			"required":             []string{"tripId"},
			"additionalProperties": false,
		},
	},
	{
		"name":        "create_trip",
		"description": "Save a new version 1 trip. The trip id must be new.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"trip": map[string]any{"type": "object"},
			},
			"required":             []string{"trip"},
			"additionalProperties": false,
		},
	},
	{
		"name":        "update_trip",
		"description": "Replace a trip the signed-in person owns. Send the full trip. The id in the trip must match tripId.",
		"inputSchema": map[string]any{
			"type": "object",
			"properties": map[string]any{
				"tripId": map[string]any{"type": "string"},
				"trip":   map[string]any{"type": "object"},
			},
			"required":             []string{"tripId", "trip"},
			"additionalProperties": false,
		},
	},
}

type Handler struct {
	Store    store.Store
	Origin   string
	Identify func(r *http.Request) (store.User, bool)
}

func (h Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	user, ok := h.Identify(r)
	if !ok {
		w.Header().Set("WWW-Authenticate", `Bearer realm="waymark", resource_metadata="`+h.Origin+`/.well-known/oauth-protected-resource", scope="`+Scope+`"`)
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	accept := r.Header.Get("Accept")
	if !strings.Contains(accept, "application/json") || !strings.Contains(accept, "text/event-stream") {
		http.Error(w, "Accept must contain both application/json and text/event-stream", http.StatusBadRequest)
		return
	}
	var raw json.RawMessage
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&raw); err != nil {
		writeRPC(w, nil, -32700, "Parse error")
		return
	}
	var msg rpcMessage
	if err := json.Unmarshal(raw, &msg); err != nil || msg.JSONRPC != "2.0" {
		writeRPC(w, nil, -32600, "Invalid Request")
		return
	}
	if msg.ID == nil && !hasID(raw) {
		w.WriteHeader(http.StatusAccepted)
		return
	}
	switch msg.Method {
	case "initialize":
		writeResult(w, msg.ID, map[string]any{
			"protocolVersion": "2025-06-18",
			"capabilities":    map[string]any{"tools": map[string]any{"listChanged": false}},
			"serverInfo":      map[string]any{"name": "waymark", "title": "Waymark", "version": "0.2.0"},
			"instructions":    instructions,
		})
	case "ping", "notifications/initialized":
		writeResult(w, msg.ID, map[string]any{})
	case "tools/list":
		writeResult(w, msg.ID, map[string]any{"tools": tools})
	case "tools/call":
		h.call(w, r, user, msg.ID, msg.Params)
	case "resources/list":
		writeResult(w, msg.ID, map[string]any{"resources": []any{}})
	case "prompts/list":
		writeResult(w, msg.ID, map[string]any{"prompts": []any{}})
	default:
		writeRPC(w, msg.ID, -32601, "Method not found")
	}
}

func (h Handler) call(w http.ResponseWriter, r *http.Request, user store.User, id any, params json.RawMessage) {
	var call struct {
		Name      string          `json:"name"`
		Arguments json.RawMessage `json:"arguments"`
	}
	if len(params) > 0 {
		if err := json.Unmarshal(params, &call); err != nil {
			writeRPC(w, id, -32602, "Invalid params")
			return
		}
	}
	data, errText := h.run(r, user, call.Name, call.Arguments)
	if errText != "" {
		writeResult(w, id, map[string]any{
			"content": []any{map[string]any{"type": "text", "text": errText}},
			"isError": true,
		})
		return
	}
	encoded, _ := json.Marshal(data)
	writeResult(w, id, map[string]any{
		"content":           []any{map[string]any{"type": "text", "text": string(encoded)}},
		"structuredContent": data,
	})
}

func (h Handler) run(r *http.Request, user store.User, name string, args json.RawMessage) (any, string) {
	switch name {
	case "list_trips":
		items, err := h.Store.ListTrips(r.Context(), user.ID)
		if err != nil {
			return nil, "The trip list could not be read."
		}
		if items == nil {
			items = []trip.Summary{}
		}
		return map[string]any{"trips": items}, ""
	case "get_trip":
		var in struct {
			TripID string `json:"tripId"`
		}
		_ = json.Unmarshal(args, &in)
		return h.owned(r, user.ID, in.TripID)
	case "create_trip":
		item, text := decodeTrip(args)
		if text != "" {
			return nil, text
		}
		if item.ID == "" {
			return nil, "The trip needs an id."
		}
		if item.CreatedAt == "" {
			item.CreatedAt = time.Now().UTC().Format(time.RFC3339)
		}
		item.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
		if issues := trip.Validate(item); len(issues) > 0 {
			return nil, strings.Join(issues, " ")
		}
		if err := h.Store.CreateTrip(r.Context(), user.ID, item); err != nil {
			if err == store.ErrConflict {
				return nil, "A trip with that id already exists."
			}
			return nil, "The trip was not saved."
		}
		return map[string]any{"ok": true, "tripId": item.ID}, ""
	case "update_trip":
		var in struct {
			TripID string          `json:"tripId"`
			Trip   json.RawMessage `json:"trip"`
		}
		if err := json.Unmarshal(args, &in); err != nil {
			return nil, "The trip was not valid JSON."
		}
		item, err := trip.Parse(in.Trip)
		if err != nil {
			return nil, "The trip was not valid JSON."
		}
		if item.ID == "" {
			item.ID = in.TripID
		}
		if item.ID != in.TripID {
			return nil, "The trip id does not match tripId."
		}
		_, current, err := h.Store.GetTrip(r.Context(), item.ID)
		if err != nil || current.ID == "" {
			return nil, "That trip was not found in this account."
		}
		owner, _, err := h.Store.GetTrip(r.Context(), item.ID)
		if err != nil || owner != user.ID {
			return nil, "That trip was not found in this account."
		}
		item.CreatedAt = current.CreatedAt
		item.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
		if issues := trip.Validate(item); len(issues) > 0 {
			return nil, strings.Join(issues, " ")
		}
		if err := h.Store.UpdateTrip(r.Context(), user.ID, item); err != nil {
			return nil, "The trip was not saved."
		}
		return map[string]any{"ok": true, "tripId": item.ID, "updatedAt": item.UpdatedAt}, ""
	default:
		return nil, "Unknown tool."
	}
}

func (h Handler) owned(r *http.Request, ownerID, tripID string) (any, string) {
	owner, item, err := h.Store.GetTrip(r.Context(), tripID)
	if err != nil || owner != ownerID {
		return nil, "That trip was not found in this account."
	}
	return map[string]any{"trip": item}, ""
}

func decodeTrip(args json.RawMessage) (trip.Trip, string) {
	var in struct {
		Trip json.RawMessage `json:"trip"`
	}
	if err := json.Unmarshal(args, &in); err != nil || len(in.Trip) == 0 {
		return trip.Trip{}, "The trip was not valid JSON."
	}
	item, err := trip.Parse(in.Trip)
	if err != nil {
		return trip.Trip{}, "The trip was not valid JSON."
	}
	return item, ""
}

type rpcMessage struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      any             `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
}

func hasID(raw json.RawMessage) bool {
	var probe map[string]json.RawMessage
	if err := json.Unmarshal(raw, &probe); err != nil {
		return false
	}
	_, ok := probe["id"]
	return ok
}

func writeResult(w http.ResponseWriter, id, result any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": id, "result": result})
}

func writeRPC(w http.ResponseWriter, id any, code int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"jsonrpc": "2.0",
		"id":      id,
		"error":   map[string]any{"code": code, "message": message},
	})
}
