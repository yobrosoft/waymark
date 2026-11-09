package firestorestore

import (
	"errors"
	"testing"

	"github.com/yobrosoft/waymark/backend/internal/store"
	"github.com/yobrosoft/waymark/backend/internal/trip"
)

func TestDocumentID(t *testing.T) {
	if err := documentID("trip-bangkok"); err != nil {
		t.Fatal(err)
	}
	if !errors.Is(documentID("a/b"), store.ErrNotFound) {
		t.Fatal("slash should be rejected")
	}
	if !errors.Is(documentID("."), store.ErrNotFound) {
		t.Fatal("dot should be rejected")
	}
}

func TestSortSummariesNewestFirst(t *testing.T) {
	items := []trip.Summary{
		{ID: "old", UpdatedAt: "2026-11-01T00:00:00Z"},
		{ID: "new", UpdatedAt: "2026-11-09T00:00:00Z"},
		{ID: "mid", UpdatedAt: "2026-11-04T00:00:00Z"},
	}
	sortSummaries(items)
	if items[0].ID != "new" || items[1].ID != "mid" || items[2].ID != "old" {
		t.Fatalf("%+v", items)
	}
}
