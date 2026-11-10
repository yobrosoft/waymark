// Package store is the trip book. SQLite implements it for local runs and tests.
// Production on Cloud Run should use the same interface with Firestore so a
// restart does not drop anyone's trips.
package store

import (
	"context"
	"errors"
	"time"

	"github.com/yobrosoft/waymark/backend/internal/trip"
)

var (
	ErrNotFound  = errors.New("not found")
	ErrConflict  = errors.New("conflict")
	ErrForbidden = errors.New("forbidden")
)

type User struct {
	ID   string
	Name string
}

// GoogleProfile is the verified identity from a Google sign-in.
type GoogleProfile struct {
	Sub   string
	Email string
	Name  string
}

type Share struct {
	Token     string
	TripID    string
	Role      string
	CreatedAt string
}

type AuthCode struct {
	UserID    string
	Challenge string
	Redirect  string
	Expires   time.Time
}

// Store persists accounts, trips, share links, and MCP OAuth grants.
type Store interface {
	CreateUser(ctx context.Context, name, tokenHash string) (User, error)
	UserByTokenHash(ctx context.Context, tokenHash string) (User, error)
	GoogleUser(ctx context.Context, profile GoogleProfile, allowCreate bool) (User, error)
	SaveSession(ctx context.Context, userID, tokenHash string) error

	CreateTrip(ctx context.Context, ownerID string, item trip.Trip) error
	UpdateTrip(ctx context.Context, ownerID string, item trip.Trip) error
	DeleteTrip(ctx context.Context, ownerID, id string) error
	GetTrip(ctx context.Context, id string) (ownerID string, item trip.Trip, err error)
	ListTrips(ctx context.Context, ownerID string) ([]trip.Summary, error)

	CreateShare(ctx context.Context, ownerID, tripID, token string) (Share, error)
	TripByShare(ctx context.Context, token string) (trip.Trip, error)

	SaveAuthCode(ctx context.Context, codeHash string, grant AuthCode) error
	ConsumeAuthCode(ctx context.Context, codeHash string) (AuthCode, error)
	SaveAccessToken(ctx context.Context, tokenHash, userID string, expires time.Time) error
	SaveRefreshToken(ctx context.Context, tokenHash, userID string, expires time.Time) error
	UserByAccessHash(ctx context.Context, tokenHash string) (User, error)
	ConsumeRefresh(ctx context.Context, tokenHash string) (userID string, expires time.Time, err error)
}
