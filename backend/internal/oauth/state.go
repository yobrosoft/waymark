package oauth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"time"

	"github.com/yobrosoft/waymark/backend/internal/secret"
)

type pending struct {
	Redirect  string `json:"redirect"`
	State     string `json:"state"`
	Challenge string `json:"challenge"`
	Resource  string `json:"resource"`
	Exp       int64  `json:"exp"`
}

func signPending(key string, q *query, now time.Time) (string, error) {
	if key == "" || q == nil {
		return "", errors.New("state")
	}
	raw, err := json.Marshal(pending{
		Redirect: q.redirect, State: q.state, Challenge: q.challenge, Resource: q.resource,
		Exp: now.Add(10 * time.Minute).Unix(),
	})
	if err != nil {
		return "", err
	}
	mac := hmac.New(sha256.New, []byte(key))
	mac.Write(raw)
	return base64.RawURLEncoding.EncodeToString(raw) + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), nil
}

func openPending(key, state string, now time.Time) (*query, error) {
	encoded, sig, ok := cut(state, ".")
	if !ok || key == "" {
		return nil, errors.New("state")
	}
	raw, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return nil, err
	}
	got, err := base64.RawURLEncoding.DecodeString(sig)
	if err != nil {
		return nil, err
	}
	mac := hmac.New(sha256.New, []byte(key))
	mac.Write(raw)
	if !secret.Same(string(mac.Sum(nil)), string(got)) {
		return nil, errors.New("state")
	}
	var body pending
	if err := json.Unmarshal(raw, &body); err != nil || body.Exp < now.Unix() {
		return nil, errors.New("state")
	}
	q := &query{redirect: body.Redirect, state: body.State, challenge: body.Challenge, resource: body.Resource}
	if !RedirectAllowed(q.redirect) || q.state == "" || len(q.challenge) != 43 {
		return nil, errors.New("state")
	}
	return q, nil
}

func cut(value, sep string) (string, string, bool) {
	for i := 0; i+len(sep) <= len(value); i++ {
		if value[i:i+len(sep)] == sep {
			return value[:i], value[i+len(sep):], true
		}
	}
	return "", "", false
}
