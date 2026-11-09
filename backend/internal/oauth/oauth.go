// Package oauth is the authorization-code flow Grok uses to connect to one Waymark account.
package oauth

import (
	"crypto/sha256"
	"encoding/base64"
	"html"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/yobrosoft/waymark/backend/internal/mcp"
	"github.com/yobrosoft/waymark/backend/internal/secret"
	"github.com/yobrosoft/waymark/backend/internal/store"
)

const clientID = "grok"

// Handler serves discovery, registration, consent, and token exchange.
type Handler struct {
	Store  store.Store
	Origin string
}

func (h Handler) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /.well-known/oauth-authorization-server", h.metadata)
	mux.HandleFunc("GET /.well-known/oauth-protected-resource", h.resource)
	mux.HandleFunc("GET /.well-known/oauth-protected-resource/mcp", h.resource)
	mux.HandleFunc("POST /oauth/register", h.register)
	mux.HandleFunc("GET /oauth/authorize", h.authorize)
	mux.HandleFunc("POST /oauth/authorize", h.authorize)
	mux.HandleFunc("POST /oauth/token", h.token)
}

func (h Handler) metadata(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"issuer":                                h.Origin,
		"authorization_endpoint":                h.Origin + "/oauth/authorize",
		"token_endpoint":                        h.Origin + "/oauth/token",
		"registration_endpoint":                 h.Origin + "/oauth/register",
		"response_types_supported":              []string{"code"},
		"grant_types_supported":                 []string{"authorization_code", "refresh_token"},
		"code_challenge_methods_supported":      []string{"S256"},
		"token_endpoint_auth_methods_supported": []string{"none"},
		"scopes_supported":                      []string{mcp.Scope},
	})
}

func (h Handler) resource(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"resource":                 h.Origin + "/mcp",
		"authorization_servers":    []string{h.Origin},
		"scopes_supported":         []string{mcp.Scope},
		"bearer_methods_supported": []string{"header"},
	})
}

func (h Handler) register(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RedirectURIs []string `json:"redirect_uris"`
	}
	if err := jsonDecode(w, r, &body); err != nil || len(body.RedirectURIs) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_client_metadata"})
		return
	}
	for _, uri := range body.RedirectURIs {
		if !RedirectAllowed(uri) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_redirect_uri"})
			return
		}
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"client_id":                  clientID,
		"client_id_issued_at":        time.Now().Unix(),
		"redirect_uris":              body.RedirectURIs,
		"grant_types":                []string{"authorization_code", "refresh_token"},
		"response_types":             []string{"code"},
		"token_endpoint_auth_method": "none",
		"scope":                      mcp.Scope,
	})
}

func (h Handler) authorize(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Error(w, "authorization request rejected", http.StatusBadRequest)
		return
	}
	query := authQuery(r.Form)
	if query == nil {
		http.Error(w, "authorization request rejected", http.StatusBadRequest)
		return
	}
	if r.Method == http.MethodGet {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = io.WriteString(w, consentPage(query))
		return
	}
	user, err := h.Store.UserByTokenHash(r.Context(), secret.Hash(r.Form.Get("token")))
	if err != nil {
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}
	code, err := secret.New("", 32)
	if err != nil {
		http.Error(w, "authorization request rejected", http.StatusInternalServerError)
		return
	}
	if err := h.Store.SaveAuthCode(r.Context(), secret.Hash(code), store.AuthCode{
		UserID:    user.ID,
		Challenge: query.challenge,
		Redirect:  query.redirect,
		Expires:   time.Now().Add(5 * time.Minute),
	}); err != nil {
		http.Error(w, "authorization request rejected", http.StatusInternalServerError)
		return
	}
	dest, _ := url.Parse(query.redirect)
	q := dest.Query()
	q.Set("code", code)
	q.Set("state", query.state)
	dest.RawQuery = q.Encode()
	http.Redirect(w, r, dest.String(), http.StatusFound)
}

func (h Handler) token(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_request"})
		return
	}
	switch r.Form.Get("grant_type") {
	case "authorization_code":
		h.authorizationCode(w, r)
	case "refresh_token":
		h.refresh(w, r)
	default:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unsupported_grant_type"})
	}
}

func (h Handler) authorizationCode(w http.ResponseWriter, r *http.Request) {
	grant, err := h.Store.ConsumeAuthCode(r.Context(), secret.Hash(r.Form.Get("code")))
	verifier := r.Form.Get("code_verifier")
	if err != nil || grant.Expires.Before(time.Now()) || r.Form.Get("client_id") != clientID || grant.Redirect != r.Form.Get("redirect_uri") || !pkce(verifier, grant.Challenge) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_grant"})
		return
	}
	h.issue(w, r, grant.UserID)
}

func (h Handler) refresh(w http.ResponseWriter, r *http.Request) {
	userID, expires, err := h.Store.ConsumeRefresh(r.Context(), secret.Hash(r.Form.Get("refresh_token")))
	client := r.Form.Get("client_id")
	if err != nil || !expires.After(time.Now()) || (client != "" && client != clientID) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_grant"})
		return
	}
	h.issue(w, r, userID)
}

func (h Handler) issue(w http.ResponseWriter, r *http.Request, userID string) {
	access, err := secret.New("", 32)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "server_error"})
		return
	}
	refresh, err := secret.New("", 32)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "server_error"})
		return
	}
	accessFor := time.Now().Add(time.Hour)
	refreshFor := time.Now().Add(30 * 24 * time.Hour)
	if err := h.Store.SaveAccessToken(r.Context(), secret.Hash(access), userID, accessFor); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "server_error"})
		return
	}
	if err := h.Store.SaveRefreshToken(r.Context(), secret.Hash(refresh), userID, refreshFor); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "server_error"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"access_token":  access,
		"token_type":    "Bearer",
		"expires_in":    3600,
		"refresh_token": refresh,
		"scope":         mcp.Scope,
	})
}

type query struct {
	redirect  string
	state     string
	challenge string
	scope     string
	resource  string
}

func authQuery(form url.Values) *query {
	q := &query{
		redirect:  form.Get("redirect_uri"),
		state:     form.Get("state"),
		challenge: form.Get("code_challenge"),
		scope:     form.Get("scope"),
		resource:  form.Get("resource"),
	}
	if form.Get("client_id") != clientID || form.Get("response_type") != "code" {
		return nil
	}
	if q.state == "" || len(q.state) > 1024 || !RedirectAllowed(q.redirect) {
		return nil
	}
	if form.Get("code_challenge_method") != "S256" || len(q.challenge) != 43 {
		return nil
	}
	if q.scope != "" && q.scope != mcp.Scope {
		return nil
	}
	return q
}

// RedirectAllowed accepts the Grok and Cursor connector callbacks, and a local callback on port 8795.
func RedirectAllowed(raw string) bool {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return false
	}
	path := strings.TrimRight(parsed.Path, "/")
	switch {
	case parsed.Scheme == "https" && parsed.Host == "grok.com" && path == "/connectors-oauth-exchange-code":
		return true
	case parsed.Scheme == "https" && parsed.Host == "www.cursor.com" && path == "/agents/mcp/oauth/callback":
		return true
	case parsed.Scheme == "http" && (parsed.Hostname() == "127.0.0.1" || parsed.Hostname() == "localhost") && parsed.Port() == "8795" && path == "/callback":
		return true
	default:
		return false
	}
}

func pkce(verifier, challenge string) bool {
	if len(verifier) < 43 || len(verifier) > 128 || len(challenge) != 43 {
		return false
	}
	sum := sha256.Sum256([]byte(verifier))
	got := base64.RawURLEncoding.EncodeToString(sum[:])
	return secret.Same(got, challenge)
}

func consentPage(q *query) string {
	fields := [][2]string{
		{"response_type", "code"},
		{"client_id", clientID},
		{"redirect_uri", q.redirect},
		{"state", q.state},
		{"code_challenge", q.challenge},
		{"code_challenge_method", "S256"},
		{"scope", mcp.Scope},
		{"resource", q.resource},
	}
	var hidden strings.Builder
	for _, field := range fields {
		hidden.WriteString(`<input type="hidden" name="`)
		hidden.WriteString(html.EscapeString(field[0]))
		hidden.WriteString(`" value="`)
		hidden.WriteString(html.EscapeString(field[1]))
		hidden.WriteString(`">`)
	}
	return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Connect Waymark</title></head><body>
<h1>Connect this agent to Waymark</h1>
<p>Paste the account token from Waymark. The agent can create and update trips in that account. A shared view link is separate.</p>
<form method="post" action="/oauth/authorize">` + hidden.String() + `
<label>Account token <input type="password" name="token" autocomplete="off" required></label>
<button type="submit">Allow</button></form></body></html>`
}
