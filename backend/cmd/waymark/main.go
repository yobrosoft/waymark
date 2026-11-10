package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/yobrosoft/waymark/backend/internal/api"
	"github.com/yobrosoft/waymark/backend/internal/firestorestore"
	"github.com/yobrosoft/waymark/backend/internal/sqlite"
	"github.com/yobrosoft/waymark/backend/internal/store"
)

func main() {
	addr := "127.0.0.1:8795"
	if port := os.Getenv("PORT"); port != "" {
		addr = ":" + port
	} else if listen := os.Getenv("WAYMARK_LISTEN"); listen != "" {
		addr = listen
	}
	db, closeStore, err := openStore()
	if err != nil {
		log.Fatal(err)
	}
	defer closeStore()

	origin := strings.TrimRight(os.Getenv("WAYMARK_PUBLIC_ORIGIN"), "/")
	if origin == "" {
		origin = "http://127.0.0.1:8795"
	}
	ui := map[string]struct{}{}
	for _, part := range strings.Split(os.Getenv("WAYMARK_UI_ORIGINS"), ",") {
		part = strings.TrimSpace(part)
		if part != "" {
			ui[part] = struct{}{}
		}
	}
	server := api.Server{
		Store:        db,
		Origin:       origin,
		AllowSignup:  os.Getenv("WAYMARK_ALLOW_SIGNUP") != "false",
		UIOrigins:    ui,
		GoogleID:     os.Getenv("WAYMARK_GOOGLE_CLIENT_ID"),
		GoogleSecret: os.Getenv("WAYMARK_GOOGLE_CLIENT_SECRET"),
	}
	log.Printf("listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, server.Handler()))
}

func openStore() (store.Store, func(), error) {
	if project := os.Getenv("WAYMARK_FIRESTORE_PROJECT"); project != "" {
		ctx := context.Background()
		db, err := firestorestore.Open(ctx, project)
		if err != nil {
			return nil, nil, err
		}
		log.Printf("store firestore project %s", project)
		return db, func() { _ = db.Close() }, nil
	}
	data := os.Getenv("WAYMARK_DATA_FILE")
	if data == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return nil, nil, err
		}
		data = filepath.Join(home, ".local", "share", "waymark", "waymark.db")
	}
	if err := os.MkdirAll(filepath.Dir(data), 0o700); err != nil {
		return nil, nil, err
	}
	db, err := sqlite.Open(data)
	if err != nil {
		return nil, nil, err
	}
	log.Printf("store sqlite %s", data)
	return db, func() { _ = db.Close() }, nil
}
