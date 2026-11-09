// Package firestorestore keeps accounts and trips in Cloud Firestore.
// Use it on Cloud Run. A restart does not drop the data.
package firestorestore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"cloud.google.com/go/firestore"
	"github.com/yobrosoft/waymark/backend/internal/store"
	"github.com/yobrosoft/waymark/backend/internal/trip"
	"google.golang.org/api/iterator"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Store is the Firestore implementation of store.Store.
type Store struct {
	client *firestore.Client
}

var _ store.Store = (*Store)(nil)

type userDoc struct {
	Name      string    `firestore:"name"`
	TokenHash string    `firestore:"tokenHash"`
	CreatedAt time.Time `firestore:"createdAt"`
}

type tripDoc struct {
	OwnerID   string `firestore:"ownerId"`
	Name      string `firestore:"name"`
	Status    string `firestore:"status"`
	Timezone  string `firestore:"timezone"`
	UpdatedAt string `firestore:"updatedAt"`
	Document  string `firestore:"document"`
}

type shareDoc struct {
	TripID    string    `firestore:"tripId"`
	Role      string    `firestore:"role"`
	CreatedAt time.Time `firestore:"createdAt"`
}

type codeDoc struct {
	UserID    string    `firestore:"userId"`
	Challenge string    `firestore:"challenge"`
	Redirect  string    `firestore:"redirect"`
	Expires   time.Time `firestore:"expires"`
}

type tokenDoc struct {
	UserID  string    `firestore:"userId"`
	Expires time.Time `firestore:"expires"`
}

// Open connects to the named project. Set FIRESTORE_EMULATOR_HOST to use the local emulator.
func Open(ctx context.Context, projectID string) (*Store, error) {
	client, err := firestore.NewClient(ctx, projectID)
	if err != nil {
		return nil, err
	}
	return &Store{client: client}, nil
}

func (s *Store) Close() error { return s.client.Close() }

func (s *Store) CreateUser(ctx context.Context, name, tokenHash string) (store.User, error) {
	ref := s.client.Collection("users").NewDoc()
	_, err := ref.Create(ctx, userDoc{Name: name, TokenHash: tokenHash, CreatedAt: time.Now().UTC()})
	if err != nil {
		return store.User{}, err
	}
	return store.User{ID: ref.ID, Name: name}, nil
}

func (s *Store) UserByTokenHash(ctx context.Context, tokenHash string) (store.User, error) {
	iter := s.client.Collection("users").Where("tokenHash", "==", tokenHash).Limit(1).Documents(ctx)
	defer iter.Stop()
	snap, err := iter.Next()
	if errors.Is(err, iterator.Done) {
		return store.User{}, store.ErrNotFound
	}
	if err != nil {
		return store.User{}, err
	}
	var doc userDoc
	if err := snap.DataTo(&doc); err != nil {
		return store.User{}, err
	}
	return store.User{ID: snap.Ref.ID, Name: doc.Name}, nil
}

func (s *Store) CreateTrip(ctx context.Context, ownerID string, item trip.Trip) error {
	if err := documentID(item.ID); err != nil {
		return err
	}
	raw, err := json.Marshal(item)
	if err != nil {
		return err
	}
	ref := s.client.Collection("trips").Doc(item.ID)
	_, err = ref.Create(ctx, tripDoc{
		OwnerID: ownerID, Name: item.Name, Status: item.Status, Timezone: item.Timezone,
		UpdatedAt: item.UpdatedAt, Document: string(raw),
	})
	if status.Code(err) == codes.AlreadyExists {
		return store.ErrConflict
	}
	return err
}

func (s *Store) UpdateTrip(ctx context.Context, ownerID string, item trip.Trip) error {
	if err := documentID(item.ID); err != nil {
		return err
	}
	raw, err := json.Marshal(item)
	if err != nil {
		return err
	}
	ref := s.client.Collection("trips").Doc(item.ID)
	return s.client.RunTransaction(ctx, func(ctx context.Context, tx *firestore.Transaction) error {
		snap, err := tx.Get(ref)
		if status.Code(err) == codes.NotFound {
			return store.ErrNotFound
		}
		if err != nil {
			return err
		}
		var current tripDoc
		if err := snap.DataTo(&current); err != nil {
			return err
		}
		if current.OwnerID != ownerID {
			return store.ErrForbidden
		}
		return tx.Set(ref, tripDoc{
			OwnerID: ownerID, Name: item.Name, Status: item.Status, Timezone: item.Timezone,
			UpdatedAt: item.UpdatedAt, Document: string(raw),
		})
	})
}

func (s *Store) GetTrip(ctx context.Context, id string) (string, trip.Trip, error) {
	if err := documentID(id); err != nil {
		return "", trip.Trip{}, store.ErrNotFound
	}
	snap, err := s.client.Collection("trips").Doc(id).Get(ctx)
	if status.Code(err) == codes.NotFound {
		return "", trip.Trip{}, store.ErrNotFound
	}
	if err != nil {
		return "", trip.Trip{}, err
	}
	var doc tripDoc
	if err := snap.DataTo(&doc); err != nil {
		return "", trip.Trip{}, err
	}
	item, err := trip.Parse([]byte(doc.Document))
	if err != nil {
		return "", trip.Trip{}, err
	}
	return doc.OwnerID, item, nil
}

func (s *Store) ListTrips(ctx context.Context, ownerID string) ([]trip.Summary, error) {
	iter := s.client.Collection("trips").Where("ownerId", "==", ownerID).Documents(ctx)
	defer iter.Stop()
	var out []trip.Summary
	for {
		snap, err := iter.Next()
		if errors.Is(err, iterator.Done) {
			break
		}
		if err != nil {
			return nil, err
		}
		var doc tripDoc
		if err := snap.DataTo(&doc); err != nil {
			return nil, err
		}
		out = append(out, trip.Summary{
			ID: snap.Ref.ID, Name: doc.Name, Status: doc.Status, Timezone: doc.Timezone, UpdatedAt: doc.UpdatedAt,
		})
	}
	sortSummaries(out)
	return out, nil
}

func (s *Store) CreateShare(ctx context.Context, ownerID, tripID, token string) (store.Share, error) {
	owner, _, err := s.GetTrip(ctx, tripID)
	if err != nil {
		return store.Share{}, err
	}
	if owner != ownerID {
		return store.Share{}, store.ErrForbidden
	}
	if err := documentID(token); err != nil {
		return store.Share{}, err
	}
	created := time.Now().UTC()
	_, err = s.client.Collection("shares").Doc(token).Create(ctx, shareDoc{TripID: tripID, Role: "view", CreatedAt: created})
	if err != nil {
		return store.Share{}, err
	}
	return store.Share{Token: token, TripID: tripID, Role: "view", CreatedAt: created.Format(time.RFC3339)}, nil
}

func (s *Store) TripByShare(ctx context.Context, token string) (trip.Trip, error) {
	if err := documentID(token); err != nil {
		return trip.Trip{}, store.ErrNotFound
	}
	snap, err := s.client.Collection("shares").Doc(token).Get(ctx)
	if status.Code(err) == codes.NotFound {
		return trip.Trip{}, store.ErrNotFound
	}
	if err != nil {
		return trip.Trip{}, err
	}
	var share shareDoc
	if err := snap.DataTo(&share); err != nil {
		return trip.Trip{}, err
	}
	_, item, err := s.GetTrip(ctx, share.TripID)
	return item, err
}

func (s *Store) SaveAuthCode(ctx context.Context, codeHash string, grant store.AuthCode) error {
	_, err := s.client.Collection("oauthCodes").Doc(codeHash).Create(ctx, codeDoc{
		UserID: grant.UserID, Challenge: grant.Challenge, Redirect: grant.Redirect, Expires: grant.Expires.UTC(),
	})
	return err
}

func (s *Store) ConsumeAuthCode(ctx context.Context, codeHash string) (store.AuthCode, error) {
	ref := s.client.Collection("oauthCodes").Doc(codeHash)
	var grant store.AuthCode
	err := s.client.RunTransaction(ctx, func(ctx context.Context, tx *firestore.Transaction) error {
		snap, err := tx.Get(ref)
		if status.Code(err) == codes.NotFound {
			return store.ErrNotFound
		}
		if err != nil {
			return err
		}
		var doc codeDoc
		if err := snap.DataTo(&doc); err != nil {
			return err
		}
		grant = store.AuthCode{UserID: doc.UserID, Challenge: doc.Challenge, Redirect: doc.Redirect, Expires: doc.Expires}
		return tx.Delete(ref)
	})
	return grant, err
}

func (s *Store) SaveAccessToken(ctx context.Context, tokenHash, userID string, expires time.Time) error {
	_, err := s.client.Collection("oauthAccess").Doc(tokenHash).Create(ctx, tokenDoc{UserID: userID, Expires: expires.UTC()})
	return err
}

func (s *Store) SaveRefreshToken(ctx context.Context, tokenHash, userID string, expires time.Time) error {
	_, err := s.client.Collection("oauthRefresh").Doc(tokenHash).Create(ctx, tokenDoc{UserID: userID, Expires: expires.UTC()})
	return err
}

func (s *Store) UserByAccessHash(ctx context.Context, tokenHash string) (store.User, error) {
	snap, err := s.client.Collection("oauthAccess").Doc(tokenHash).Get(ctx)
	if status.Code(err) == codes.NotFound {
		return store.User{}, store.ErrNotFound
	}
	if err != nil {
		return store.User{}, err
	}
	var doc tokenDoc
	if err := snap.DataTo(&doc); err != nil {
		return store.User{}, err
	}
	if !doc.Expires.After(time.Now()) {
		_, _ = snap.Ref.Delete(ctx)
		return store.User{}, store.ErrNotFound
	}
	userSnap, err := s.client.Collection("users").Doc(doc.UserID).Get(ctx)
	if status.Code(err) == codes.NotFound {
		return store.User{}, store.ErrNotFound
	}
	if err != nil {
		return store.User{}, err
	}
	var user userDoc
	if err := userSnap.DataTo(&user); err != nil {
		return store.User{}, err
	}
	return store.User{ID: userSnap.Ref.ID, Name: user.Name}, nil
}

func (s *Store) ConsumeRefresh(ctx context.Context, tokenHash string) (string, time.Time, error) {
	ref := s.client.Collection("oauthRefresh").Doc(tokenHash)
	var userID string
	var expires time.Time
	err := s.client.RunTransaction(ctx, func(ctx context.Context, tx *firestore.Transaction) error {
		snap, err := tx.Get(ref)
		if status.Code(err) == codes.NotFound {
			return store.ErrNotFound
		}
		if err != nil {
			return err
		}
		var doc tokenDoc
		if err := snap.DataTo(&doc); err != nil {
			return err
		}
		userID, expires = doc.UserID, doc.Expires
		return tx.Delete(ref)
	})
	if err != nil {
		return "", time.Time{}, err
	}
	if !expires.After(time.Now()) {
		return "", time.Time{}, store.ErrNotFound
	}
	return userID, expires, nil
}

func documentID(id string) error {
	if id == "" || id == "." || id == ".." || strings.Contains(id, "/") {
		return fmt.Errorf("%w: document id", store.ErrNotFound)
	}
	return nil
}

func sortSummaries(items []trip.Summary) {
	for i := 1; i < len(items); i++ {
		item := items[i]
		j := i
		for j > 0 && items[j-1].UpdatedAt < item.UpdatedAt {
			items[j] = items[j-1]
			j--
		}
		items[j] = item
	}
}
