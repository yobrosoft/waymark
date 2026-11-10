package googleauth

import "testing"

func TestAccountRequiresVerifiedEmail(t *testing.T) {
	if _, err := Account(Profile{Sub: "sub", Email: "joel@example.com", Name: "Joel", EmailVerified: false}); err == nil {
		t.Fatal("unverified email was accepted")
	}
	got, err := Account(Profile{Sub: "sub", Email: "Joel@Example.com", Name: "  Joel\nBrower  ", EmailVerified: true})
	if err != nil {
		t.Fatal(err)
	}
	if got.Email != "joel@example.com" || got.Name != "Joel Brower" || got.Sub != "sub" {
		t.Fatalf("profile %+v", got)
	}
}
