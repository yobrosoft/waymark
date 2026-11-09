// Package sqlite stores Waymark accounts and trips in one file.
package sqlite

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/yobrosoft/waymark/backend/internal/store"
	"github.com/yobrosoft/waymark/backend/internal/trip"
	_ "modernc.org/sqlite"
)

type DB struct {
	sql *sql.DB
}

func Open(path string) (*DB, error) {
	dsn := "file:" + path + "?_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if err := migrate(db); err != nil {
		_ = db.Close()
		return nil, err
	}
	return &DB{sql: db}, nil
}

func (db *DB) Close() error { return db.sql.Close() }

func migrate(db *sql.DB) error {
	_, err := db.Exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  timezone TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  document TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS trips_owner ON trips(owner_id, updated_at);
CREATE TABLE IF NOT EXISTS shares (
  token TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips(id),
  role TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  challenge TEXT NOT NULL,
  redirect TEXT NOT NULL,
  expires TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_access (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_refresh (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires TEXT NOT NULL
);
`)
	return err
}

func (db *DB) CreateUser(ctx context.Context, name, tokenHash string) (store.User, error) {
	id := "usr-" + randomID()
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := db.sql.ExecContext(ctx, `INSERT INTO users (id, name, token_hash, created_at) VALUES (?, ?, ?, ?)`, id, name, tokenHash, now)
	if err != nil {
		return store.User{}, err
	}
	return store.User{ID: id, Name: name}, nil
}

func (db *DB) UserByTokenHash(ctx context.Context, tokenHash string) (store.User, error) {
	return db.userWhere(ctx, `SELECT id, name FROM users WHERE token_hash = ?`, tokenHash)
}

func (db *DB) CreateTrip(ctx context.Context, ownerID string, item trip.Trip) error {
	raw, err := json.Marshal(item)
	if err != nil {
		return err
	}
	_, err = db.sql.ExecContext(ctx, `
INSERT INTO trips (id, owner_id, name, status, timezone, updated_at, document)
VALUES (?, ?, ?, ?, ?, ?, ?)`, item.ID, ownerID, item.Name, item.Status, item.Timezone, item.UpdatedAt, string(raw))
	if err != nil {
		if isUnique(err) {
			return store.ErrConflict
		}
		return err
	}
	return nil
}

func (db *DB) UpdateTrip(ctx context.Context, ownerID string, item trip.Trip) error {
	raw, err := json.Marshal(item)
	if err != nil {
		return err
	}
	result, err := db.sql.ExecContext(ctx, `
UPDATE trips SET name = ?, status = ?, timezone = ?, updated_at = ?, document = ?
WHERE id = ? AND owner_id = ?`, item.Name, item.Status, item.Timezone, item.UpdatedAt, string(raw), item.ID, ownerID)
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if n == 1 {
		return nil
	}
	var exists int
	if err := db.sql.QueryRowContext(ctx, `SELECT 1 FROM trips WHERE id = ?`, item.ID).Scan(&exists); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return store.ErrNotFound
		}
		return err
	}
	return store.ErrForbidden
}

func (db *DB) GetTrip(ctx context.Context, id string) (string, trip.Trip, error) {
	var owner, raw string
	err := db.sql.QueryRowContext(ctx, `SELECT owner_id, document FROM trips WHERE id = ?`, id).Scan(&owner, &raw)
	if errors.Is(err, sql.ErrNoRows) {
		return "", trip.Trip{}, store.ErrNotFound
	}
	if err != nil {
		return "", trip.Trip{}, err
	}
	item, err := trip.Parse([]byte(raw))
	if err != nil {
		return "", trip.Trip{}, err
	}
	return owner, item, nil
}

func (db *DB) ListTrips(ctx context.Context, ownerID string) ([]trip.Summary, error) {
	rows, err := db.sql.QueryContext(ctx, `
SELECT id, name, status, timezone, updated_at FROM trips
WHERE owner_id = ? ORDER BY updated_at DESC`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []trip.Summary
	for rows.Next() {
		var item trip.Summary
		if err := rows.Scan(&item.ID, &item.Name, &item.Status, &item.Timezone, &item.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (db *DB) CreateShare(ctx context.Context, ownerID, tripID, token string) (store.Share, error) {
	owner, _, err := db.GetTrip(ctx, tripID)
	if err != nil {
		return store.Share{}, err
	}
	if owner != ownerID {
		return store.Share{}, store.ErrForbidden
	}
	created := time.Now().UTC().Format(time.RFC3339)
	_, err = db.sql.ExecContext(ctx, `INSERT INTO shares (token, trip_id, role, created_at) VALUES (?, ?, 'view', ?)`, token, tripID, created)
	if err != nil {
		return store.Share{}, err
	}
	return store.Share{Token: token, TripID: tripID, Role: "view", CreatedAt: created}, nil
}

func (db *DB) TripByShare(ctx context.Context, token string) (trip.Trip, error) {
	var raw string
	err := db.sql.QueryRowContext(ctx, `
SELECT trips.document FROM shares JOIN trips ON trips.id = shares.trip_id WHERE shares.token = ?`, token).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return trip.Trip{}, store.ErrNotFound
	}
	if err != nil {
		return trip.Trip{}, err
	}
	return trip.Parse([]byte(raw))
}

func (db *DB) SaveAuthCode(ctx context.Context, codeHash string, grant store.AuthCode) error {
	_, err := db.sql.ExecContext(ctx, `
INSERT INTO oauth_codes (code_hash, user_id, challenge, redirect, expires) VALUES (?, ?, ?, ?, ?)`,
		codeHash, grant.UserID, grant.Challenge, grant.Redirect, grant.Expires.UTC().Format(time.RFC3339Nano))
	return err
}

func (db *DB) ConsumeAuthCode(ctx context.Context, codeHash string) (store.AuthCode, error) {
	var grant store.AuthCode
	var expires string
	err := db.sql.QueryRowContext(ctx, `
DELETE FROM oauth_codes WHERE code_hash = ? RETURNING user_id, challenge, redirect, expires`, codeHash).
		Scan(&grant.UserID, &grant.Challenge, &grant.Redirect, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		return store.AuthCode{}, store.ErrNotFound
	}
	if err != nil {
		return store.AuthCode{}, err
	}
	grant.Expires, err = time.Parse(time.RFC3339Nano, expires)
	return grant, err
}

func (db *DB) SaveAccessToken(ctx context.Context, tokenHash, userID string, expires time.Time) error {
	_, err := db.sql.ExecContext(ctx, `INSERT INTO oauth_access (token_hash, user_id, expires) VALUES (?, ?, ?)`, tokenHash, userID, expires.UTC().Format(time.RFC3339Nano))
	return err
}

func (db *DB) SaveRefreshToken(ctx context.Context, tokenHash, userID string, expires time.Time) error {
	_, err := db.sql.ExecContext(ctx, `INSERT INTO oauth_refresh (token_hash, user_id, expires) VALUES (?, ?, ?)`, tokenHash, userID, expires.UTC().Format(time.RFC3339Nano))
	return err
}

func (db *DB) UserByAccessHash(ctx context.Context, tokenHash string) (store.User, error) {
	var user store.User
	var expires string
	err := db.sql.QueryRowContext(ctx, `
SELECT users.id, users.name, oauth_access.expires
FROM oauth_access JOIN users ON users.id = oauth_access.user_id
WHERE oauth_access.token_hash = ?`, tokenHash).Scan(&user.ID, &user.Name, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		return store.User{}, store.ErrNotFound
	}
	if err != nil {
		return store.User{}, err
	}
	when, err := time.Parse(time.RFC3339Nano, expires)
	if err != nil {
		return store.User{}, err
	}
	if !when.After(time.Now()) {
		_, _ = db.sql.ExecContext(ctx, `DELETE FROM oauth_access WHERE token_hash = ?`, tokenHash)
		return store.User{}, store.ErrNotFound
	}
	return user, nil
}

func (db *DB) ConsumeRefresh(ctx context.Context, tokenHash string) (string, time.Time, error) {
	var userID, expires string
	err := db.sql.QueryRowContext(ctx, `
DELETE FROM oauth_refresh WHERE token_hash = ? RETURNING user_id, expires`, tokenHash).Scan(&userID, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		return "", time.Time{}, store.ErrNotFound
	}
	if err != nil {
		return "", time.Time{}, err
	}
	when, err := time.Parse(time.RFC3339Nano, expires)
	if err != nil {
		return "", time.Time{}, err
	}
	if !when.After(time.Now()) {
		return "", time.Time{}, store.ErrNotFound
	}
	return userID, when, nil
}

func (db *DB) userWhere(ctx context.Context, query, arg string) (store.User, error) {
	var user store.User
	err := db.sql.QueryRowContext(ctx, query, arg).Scan(&user.ID, &user.Name)
	if errors.Is(err, sql.ErrNoRows) {
		return store.User{}, store.ErrNotFound
	}
	return user, err
}

func isUnique(err error) bool {
	return err != nil && strings.Contains(strings.ToUpper(err.Error()), "UNIQUE")
}

func randomID() string {
	var buf [12]byte
	if _, err := rand.Read(buf[:]); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(buf[:])
}
