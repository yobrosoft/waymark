package trip

import "testing"

func TestTransitLegMode(t *testing.T) {
	raw := []byte(`{
		"schemaVersion": 1,
		"id": "t1",
		"name": "Bangkok",
		"summary": "",
		"timezone": "Asia/Bangkok",
		"status": "proposed",
		"days": [{"id": "d1", "date": "2026-12-08", "title": "Arrival", "notes": ""}],
		"locations": [
			{"id": "p1", "name": "Hotel", "address": "", "lat": 13.70, "lon": 100.53, "pinNote": ""},
			{"id": "p2", "name": "Station", "address": "", "lat": 13.73, "lon": 100.56, "pinNote": ""}
		],
		"stops": [
			{"id": "s1", "locationId": "p1", "dayId": "d1", "plannedTime": "09:30", "status": "proposed", "notes": "", "access": ""},
			{"id": "s2", "locationId": "p2", "dayId": "d1", "plannedTime": "10:00", "status": "proposed", "notes": "", "access": ""}
		],
		"legModes": {"s1>s2": "transit"},
		"createdAt": "2026-11-11T00:00:00Z",
		"updatedAt": "2026-11-11T00:00:00Z"
	}`)
	parsed, err := Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	if issues := Validate(parsed); len(issues) != 0 {
		t.Fatalf("transit leg: %v", issues)
	}
	parsed.LegModes["s1>s2"] = "taxi"
	issues := Validate(parsed)
	if len(issues) == 0 {
		t.Fatal("taxi was accepted")
	}
}
