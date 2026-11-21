package main

import (
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"
)

const normalKey = "normal:countries:quick"
const hardKey = "hardcore:countries:quick"

func fixture(t *testing.T) (fs.FS, atlasIDs) {
	t.Helper()
	web, err := fs.Sub(bundle, "dist")
	if err != nil {
		t.Fatal(err)
	}
	a, err := loadAtlasIDs(web)
	if err != nil {
		t.Fatal(err)
	}
	return web, a
}

func TestLatestRecordDedupAndQuota(t *testing.T) {
	_, a := fixture(t)
	dir := t.TempDir()
	store, err := openStore(dir, 3*diskCost(100), a)
	if err != nil {
		t.Fatal(err)
	}
	first := strings.Repeat("a", 64)
	second := strings.Repeat("b", 64)
	third := strings.Repeat("c", 64)
	solve := func(id string, p int64) change { return change{Type: "solve", Key: normalKey, ID: id, Points: p} }
	for _, item := range []struct {
		id      string
		changes []change
	}{
		{first, []change{solve("JP", 100)}},
		{second, []change{solve("US", 25)}},
		{first, []change{solve("JP", 50), solve("KR", 50)}},
	} {
		if _, err := store.update(item.id, item.changes); err != nil {
			t.Fatal(err)
		}
	}
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != 2 {
		t.Fatalf("expected two latest records, got %d", len(entries))
	}
	if _, err := store.update(third, []change{solve("FR", 100), solve("NO", 50)}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.update(strings.Repeat("d", 64), []change{solve("US", 100)}); !errors.Is(err, errStorageFull) {
		t.Fatalf("quota error = %v", err)
	}
	reopened, err := openStore(dir, 3*diskCost(100), a)
	if err != nil {
		t.Fatal(err)
	}
	stored, err := reopened.get(first)
	if err != nil || stored.Progress.Regular.Score != 150 {
		t.Fatalf("latest result after restart: %v", stored)
	}
}

func TestHardcoreResetDropsStaleAnswers(t *testing.T) {
	_, a := fixture(t)
	before := a.apply(nil, []change{{Type: "solve", Key: hardKey, ID: "JP", Points: 50}, {Type: "solve", Key: normalKey, ID: "JP", Points: 100}})
	state := a.apply(before, []change{{Type: "reset", Epoch: 0}, {Type: "solve", Key: hardKey, ID: "EG", Points: 50, Epoch: 0}})
	state = a.apply(state, []change{{Type: "reset", Epoch: 0}, {Type: "solve", Key: hardKey, ID: "KR", Points: 50, Epoch: 1}})
	if state.Epoch != 1 || state.Progress.Hardcore.Score != 50 || state.Progress.Regular.Score != 100 || state.Progress.Hardcore.Painted["countries"]["EG"] {
		t.Fatal("stale hardcore operation changed the latest result")
	}
}

func TestAccountHTTP(t *testing.T) {
	web, a := fixture(t)
	t.Setenv("PUBLIC_URL", "https://terra.example")
	t.Setenv("AUTH_SECRET", "test-fixture-5eff4bb3-9f98-4c3f-b26b")
	t.Setenv("AUTH_GOOGLE_ID", "fixture-google")
	t.Setenv("AUTH_GOOGLE_SECRET", "fixture")
	t.Setenv("AUTH_APPLE_ID", "fixture-apple")
	t.Setenv("AUTH_APPLE_SECRET", "fixture")
	origin, _ := url.Parse("https://terra.example")
	auth, err := configureAuth(origin)
	if err != nil {
		t.Fatal(err)
	}
	store, err := openStore(t.TempDir(), storageCap, a)
	if err != nil {
		t.Fatal(err)
	}
	server := routes(web, auth, store)
	login := httptest.NewRecorder()
	server.ServeHTTP(login, httptest.NewRequest("GET", origin.String()+"/auth/start/google", nil))
	u, err := url.Parse(login.Header().Get("Location"))
	if err != nil || login.Code != 303 || u.Host != "accounts.google.com" || u.Query().Get("code_challenge_method") != "S256" || u.Query().Get("state") == "" {
		t.Fatal("Google authorize URL is invalid")
	}
	apple := httptest.NewRecorder()
	server.ServeHTTP(apple, httptest.NewRequest("GET", origin.String()+"/auth/start/apple", nil))
	appleURL, _ := url.Parse(apple.Header().Get("Location"))
	if apple.Code != 303 || appleURL.Query().Get("response_mode") != "form_post" || apple.Result().Cookies()[0].SameSite != http.SameSiteNoneMode {
		t.Fatal("Apple form-post flow is invalid")
	}
	id := strings.Repeat("a", 64)
	received := httptest.NewRecorder()
	auth.writeCookie(received, "terra-session", "/", account{ID: id, Provider: "google", Expires: time.Now().Add(time.Hour).Unix()}, 3600, http.SameSiteLaxMode)
	cookie := received.Result().Cookies()[0]
	post := func(originHeader, accountID string) int {
		body, _ := json.Marshal(map[string]any{"accountId": accountID, "changes": []change{{Type: "solve", Key: normalKey, ID: "JP", Points: 100}}})
		request := httptest.NewRequest("POST", origin.String()+"/api/progress", strings.NewReader(string(body)))
		request.Header.Set("Origin", originHeader)
		request.AddCookie(cookie)
		response := httptest.NewRecorder()
		server.ServeHTTP(response, request)
		return response.Code
	}
	if code := post("https://wrong.example", id); code != 403 {
		t.Fatalf("cross-origin status %d", code)
	}
	if code := post(origin.String(), strings.Repeat("b", 64)); code != 409 {
		t.Fatalf("wrong account status %d", code)
	}
	if code := post(origin.String(), id); code != 200 {
		t.Fatalf("save status %d", code)
	}
	if code := post(origin.String(), id); code != 200 {
		t.Fatalf("retry status %d", code)
	}
	value, err := store.get(id)
	if err != nil || value.Progress.Regular.Score != 100 {
		t.Fatal("result did not persist once")
	}
}
