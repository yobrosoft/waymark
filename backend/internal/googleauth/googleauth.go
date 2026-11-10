// Package googleauth checks Google sign-in tokens for one OAuth client.
package googleauth

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"unicode/utf8"

	"github.com/yobrosoft/waymark/backend/internal/store"
	"google.golang.org/api/idtoken"
)

// Profile is a Google account that presented an ID token.
type Profile struct {
	Sub           string
	Email         string
	Name          string
	EmailVerified bool
}

// Verify checks an ID token against Google's certificates and this client id.
func Verify(ctx context.Context, raw, audience string) (Profile, error) {
	payload, err := idtoken.Validate(ctx, raw, audience)
	if err != nil {
		return Profile{}, err
	}
	email, _ := payload.Claims["email"].(string)
	name, _ := payload.Claims["name"].(string)
	verified := false
	switch value := payload.Claims["email_verified"].(type) {
	case bool:
		verified = value
	case string:
		verified = value == "true"
	}
	return Profile{Sub: payload.Subject, Email: email, Name: name, EmailVerified: verified}, nil
}

// Exchange trades an authorization code for an ID token.
func Exchange(ctx context.Context, clientID, clientSecret, code, redirectURI string) (string, error) {
	form := url.Values{}
	form.Set("code", code)
	form.Set("client_id", clientID)
	form.Set("client_secret", clientSecret)
	form.Set("redirect_uri", redirectURI)
	form.Set("grant_type", "authorization_code")
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://oauth2.googleapis.com/token", strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 1<<16))
	if err != nil {
		return "", err
	}
	if res.StatusCode != http.StatusOK {
		return "", errors.New("google token exchange failed")
	}
	var token struct {
		IDToken string `json:"id_token"`
	}
	if err := json.Unmarshal(body, &token); err != nil || token.IDToken == "" {
		return "", errors.New("google token exchange failed")
	}
	return token.IDToken, nil
}

// Account turns a verified Google profile into the fields Waymark stores.
func Account(profile Profile) (store.GoogleProfile, error) {
	sub := strings.TrimSpace(profile.Sub)
	if sub == "" || len(sub) > 255 || strings.Contains(sub, "/") {
		return store.GoogleProfile{}, errors.New("google profile")
	}
	email := strings.ToLower(strings.TrimSpace(profile.Email))
	if !profile.EmailVerified || len(email) > 254 || !strings.Contains(email, "@") {
		return store.GoogleProfile{}, errors.New("google email")
	}
	name := strings.Join(strings.Fields(profile.Name), " ")
	if name == "" {
		name = strings.Split(email, "@")[0]
	}
	if utf8.RuneCountInString(name) > 80 {
		name = string([]rune(name)[:80])
		name = strings.TrimSpace(name)
	}
	if name == "" {
		return store.GoogleProfile{}, errors.New("google profile")
	}
	return store.GoogleProfile{Sub: sub, Email: email, Name: name}, nil
}
