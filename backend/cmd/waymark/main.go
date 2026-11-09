package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/yobrosoft/waymark/backend/internal/api"
	"github.com/yobrosoft/waymark/backend/internal/sqlite"
)

func main() {
	addr := "127.0.0.1:8795"
	if port := os.Getenv("PORT"); port != "" {
		addr = ":" + port
	} else if listen := os.Getenv("WAYMARK_LISTEN"); listen != "" {
		addr = listen
	}
	data := os.Getenv("WAYMARK_DATA_FILE")
	if data == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			log.Fatal(err)
		}
		data = filepath.Join(home, ".local", "share", "waymark", "waymark.db")
	}
	if err := os.MkdirAll(filepath.Dir(data), 0o700); err != nil {
		log.Fatal(err)
	}
	db, err := sqlite.Open(data)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

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
		Store:       db,
		Origin:      origin,
		AllowSignup: os.Getenv("WAYMARK_ALLOW_SIGNUP") != "false",
		UIOrigins:   ui,
	}
	log.Printf("listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, server.Handler()))
}
