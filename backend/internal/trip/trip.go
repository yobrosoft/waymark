// Package trip is the version 1 trip document shared by the TypeScript app and the Go API.
package trip

import (
	"bytes"
	"encoding/json"
	"fmt"
	"regexp"
	"time"
	"unicode/utf8"
)

const SchemaVersion = 1

var (
	timestampPattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$`)
	datePattern      = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	legKeyPattern    = regexp.MustCompile(`^[^>]{1,80}>[^>]{1,80}$`)
)

// Trip is a proposed plan, not a booking.
type Trip struct {
	SchemaVersion int               `json:"schemaVersion"`
	ID            string            `json:"id"`
	Name          string            `json:"name"`
	Summary       string            `json:"summary"`
	Timezone      string            `json:"timezone"`
	Status        string            `json:"status"`
	Days          []Day             `json:"days"`
	Locations     []Place           `json:"locations"`
	Stops         []Stop            `json:"stops"`
	LegModes      map[string]string `json:"legModes"`
	CreatedAt     string            `json:"createdAt"`
	UpdatedAt     string            `json:"updatedAt"`
	Kind          string            `json:"kind,omitempty"`
	ExportedAt    string            `json:"exportedAt,omitempty"`
}

type Day struct {
	ID    string `json:"id"`
	Date  string `json:"date"`
	Title string `json:"title"`
	Notes string `json:"notes"`
}

type Place struct {
	ID      string  `json:"id"`
	Name    string  `json:"name"`
	Address string  `json:"address"`
	Lat     float64 `json:"lat"`
	Lon     float64 `json:"lon"`
	PinNote string  `json:"pinNote"`
}

type Stop struct {
	ID          string `json:"id"`
	LocationID  string `json:"locationId"`
	DayID       string `json:"dayId"`
	PlannedTime string `json:"plannedTime"`
	Status      string `json:"status"`
	Notes       string `json:"notes"`
	Access      string `json:"access"`
}

// Summary is the list row. The full document stays out of list responses.
type Summary struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Status    string `json:"status"`
	Timezone  string `json:"timezone"`
	UpdatedAt string `json:"updatedAt"`
}

// Parse decodes one trip and rejects unknown fields.
func Parse(raw []byte) (Trip, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	var trip Trip
	if err := dec.Decode(&trip); err != nil {
		return Trip{}, fmt.Errorf("trip JSON: %w", err)
	}
	var extra any
	if err := dec.Decode(&extra); err != nil && err.Error() != "EOF" {
		return Trip{}, fmt.Errorf("trip JSON: %w", err)
	}
	if trip.LegModes == nil {
		trip.LegModes = map[string]string{}
	}
	if trip.Locations == nil {
		trip.Locations = []Place{}
	}
	if trip.Stops == nil {
		trip.Stops = []Stop{}
	}
	return trip, nil
}

// Validate checks the version 1 shape and that stops point at real days and places.
func Validate(trip Trip) []string {
	var issues []string
	push := func(format string, args ...any) {
		issues = append(issues, fmt.Sprintf(format, args...))
	}
	if trip.SchemaVersion != SchemaVersion {
		push("schemaVersion: version %d is required.", SchemaVersion)
	}
	if !idOK(trip.ID) {
		push("id: use 1 to 80 characters.")
	}
	if !textOK(trip.Name, 1, 160) {
		push("name: use 1 to 160 characters.")
	}
	if utf8.RuneCountInString(trip.Summary) > 2000 {
		push("summary: use at most 2000 characters.")
	}
	if !textOK(trip.Timezone, 1, 80) || !validTimezone(trip.Timezone) {
		push("timezone: %s is not a known time zone.", trip.Timezone)
	}
	if trip.Status != "proposed" && trip.Status != "draft" && trip.Status != "confirmed" {
		push("status: use proposed, draft, or confirmed.")
	}
	if !timestampPattern.MatchString(trip.CreatedAt) {
		push("createdAt: use a UTC timestamp.")
	}
	if !timestampPattern.MatchString(trip.UpdatedAt) {
		push("updatedAt: use a UTC timestamp.")
	}
	if trip.Kind != "" && trip.Kind != "waymark.trip" {
		push("kind: use waymark.trip.")
	}
	if trip.ExportedAt != "" && !timestampPattern.MatchString(trip.ExportedAt) {
		push("exportedAt: use a UTC timestamp.")
	}
	if len(trip.Days) < 1 || len(trip.Days) > 60 {
		push("days: include 1 to 60 days.")
	}
	if len(trip.Locations) > 200 {
		push("locations: use at most 200 places.")
	}
	if len(trip.Stops) > 200 {
		push("stops: use at most 200 stops.")
	}
	if len(trip.LegModes) > 400 {
		push("legModes: use at most 400 legs.")
	}

	dayIDs := map[string]struct{}{}
	for _, day := range trip.Days {
		if !idOK(day.ID) {
			push("days: each day needs an id of 1 to 80 characters.")
			continue
		}
		if _, ok := dayIDs[day.ID]; ok {
			push("days: duplicate id %s.", day.ID)
		}
		dayIDs[day.ID] = struct{}{}
		if !realDate(day.Date) {
			push("days.%s: %s is not a real date.", day.ID, day.Date)
		}
		if !textOK(day.Title, 1, 120) {
			push("days.%s.title: use 1 to 120 characters.", day.ID)
		}
		if utf8.RuneCountInString(day.Notes) > 2000 {
			push("days.%s.notes: use at most 2000 characters.", day.ID)
		}
	}
	placeIDs := map[string]struct{}{}
	for _, place := range trip.Locations {
		if !idOK(place.ID) {
			push("locations: each place needs an id of 1 to 80 characters.")
			continue
		}
		if _, ok := placeIDs[place.ID]; ok {
			push("locations: duplicate id %s.", place.ID)
		}
		placeIDs[place.ID] = struct{}{}
		if !textOK(place.Name, 1, 160) {
			push("locations.%s.name: use 1 to 160 characters.", place.ID)
		}
		if utf8.RuneCountInString(place.Address) > 300 {
			push("locations.%s.address: use at most 300 characters.", place.ID)
		}
		if place.Lat < -90 || place.Lat > 90 || place.Lon < -180 || place.Lon > 180 {
			push("locations.%s: coordinates are out of range.", place.ID)
		}
		if utf8.RuneCountInString(place.PinNote) > 600 {
			push("locations.%s.pinNote: use at most 600 characters.", place.ID)
		}
	}
	stopIDs := map[string]struct{}{}
	for _, stop := range trip.Stops {
		if !idOK(stop.ID) {
			push("stops: each stop needs an id of 1 to 80 characters.")
			continue
		}
		if _, ok := stopIDs[stop.ID]; ok {
			push("stops: duplicate id %s.", stop.ID)
		}
		stopIDs[stop.ID] = struct{}{}
		if _, ok := placeIDs[stop.LocationID]; !ok {
			push("stops.%s: unknown place %s.", stop.ID, stop.LocationID)
		}
		if _, ok := dayIDs[stop.DayID]; !ok {
			push("stops.%s: unknown day %s.", stop.ID, stop.DayID)
		}
		if utf8.RuneCountInString(stop.PlannedTime) > 160 {
			push("stops.%s.plannedTime: use at most 160 characters.", stop.ID)
		}
		switch stop.Status {
		case "proposed", "confirmed", "optional", "buffer":
		default:
			push("stops.%s.status: use proposed, confirmed, optional, or buffer.", stop.ID)
		}
		if utf8.RuneCountInString(stop.Notes) > 2000 {
			push("stops.%s.notes: use at most 2000 characters.", stop.ID)
		}
		if utf8.RuneCountInString(stop.Access) > 600 {
			push("stops.%s.access: use at most 600 characters.", stop.ID)
		}
	}
	for key, mode := range trip.LegModes {
		if !legKeyPattern.MatchString(key) {
			push("legModes: invalid key %s.", key)
			continue
		}
		if mode != "driving" && mode != "walking" && mode != "cycling" && mode != "transit" {
			push("legModes.%s: use driving, walking, cycling, or transit.", key)
		}
		from, to, _ := bytes.Cut([]byte(key), []byte(">"))
		if _, ok := stopIDs[string(from)]; !ok {
			push("legModes: %s does not match two stops.", key)
			continue
		}
		if _, ok := stopIDs[string(to)]; !ok {
			push("legModes: %s does not match two stops.", key)
		}
	}
	return issues
}

func idOK(value string) bool {
	n := utf8.RuneCountInString(value)
	return n >= 1 && n <= 80
}

func textOK(value string, min, max int) bool {
	n := utf8.RuneCountInString(value)
	return n >= min && n <= max
}

func validTimezone(value string) bool {
	_, err := time.LoadLocation(value)
	return err == nil
}

func realDate(value string) bool {
	if !datePattern.MatchString(value) {
		return false
	}
	parsed, err := time.Parse("2006-01-02", value)
	return err == nil && parsed.Format("2006-01-02") == value
}
