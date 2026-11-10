package oauth

import (
	"errors"
	"net/http"
	"net/url"
	"time"

	"github.com/yobrosoft/waymark/backend/internal/googleauth"
	"github.com/yobrosoft/waymark/backend/internal/store"
)

func (h Handler) googleReady() bool {
	return h.GoogleID != "" && h.GoogleSecret != ""
}

func (h Handler) googleAuthURL(q *query) string {
	if !h.googleReady() {
		return ""
	}
	state, err := signPending(h.GoogleSecret, q, time.Now())
	if err != nil {
		return ""
	}
	values := url.Values{}
	values.Set("client_id", h.GoogleID)
	values.Set("redirect_uri", h.googleRedirect())
	values.Set("response_type", "code")
	values.Set("scope", "openid email profile")
	values.Set("state", state)
	values.Set("prompt", "select_account")
	return "https://accounts.google.com/o/oauth2/v2/auth?" + values.Encode()
}

func (h Handler) googleRedirect() string {
	return h.Origin + "/oauth/google/callback"
}

func (h Handler) googleCallback(w http.ResponseWriter, r *http.Request) {
	fail := func(status int, message string) {
		http.Error(w, message, status)
	}
	if !h.googleReady() || r.URL.Query().Get("error") != "" || r.URL.Query().Get("code") == "" {
		fail(http.StatusBadRequest, "Google sign-in did not complete.")
		return
	}
	query, err := openPending(h.GoogleSecret, r.URL.Query().Get("state"), time.Now())
	if err != nil {
		fail(http.StatusBadRequest, "Google sign-in did not complete.")
		return
	}
	idToken, err := h.exchangeCode(r, r.URL.Query().Get("code"))
	if err != nil {
		fail(http.StatusBadRequest, "Google sign-in did not complete.")
		return
	}
	profile, err := h.verifyToken(r, idToken)
	if err != nil {
		fail(http.StatusUnauthorized, "Google sign-in did not complete.")
		return
	}
	account, err := googleauth.Account(profile)
	if err != nil {
		fail(http.StatusUnauthorized, "That Google account has no verified email.")
		return
	}
	user, err := h.Store.GoogleUser(r.Context(), account, h.AllowSignup)
	if errors.Is(err, store.ErrForbidden) {
		fail(http.StatusForbidden, "Account signup is turned off.")
		return
	}
	if err != nil {
		fail(http.StatusInternalServerError, "Google sign-in did not complete.")
		return
	}
	h.finish(w, r, query, user)
}

func (h Handler) exchangeCode(r *http.Request, code string) (string, error) {
	if h.Exchange != nil {
		return h.Exchange(r.Context(), code, h.googleRedirect())
	}
	return googleauth.Exchange(r.Context(), h.GoogleID, h.GoogleSecret, code, h.googleRedirect())
}

func (h Handler) verifyToken(r *http.Request, raw string) (googleauth.Profile, error) {
	if h.Verify != nil {
		return h.Verify(r.Context(), raw)
	}
	return googleauth.Verify(r.Context(), raw, h.GoogleID)
}
