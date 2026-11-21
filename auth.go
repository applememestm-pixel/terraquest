package main

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"html/template"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

type provider struct {
	Name   string
	config oauth2.Config
	verify *oidc.IDTokenVerifier
}

type authentication struct {
	origin    string
	secure    bool
	secret    []byte
	providers map[string]provider
	client    *http.Client
}

type account struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Provider string `json:"provider"`
	Expires  int64  `json:"expires"`
}

type loginAttempt struct {
	State, Nonce, Verifier string
	Expires                int64
}

func configureAuth(origin *url.URL) (*authentication, error) {
	a := &authentication{
		origin: origin.Scheme + "://" + origin.Host, secure: origin.Scheme == "https",
		secret: []byte(os.Getenv("AUTH_SECRET")), providers: make(map[string]provider),
		client: &http.Client{Timeout: 12 * time.Second},
	}
	type metadata struct{ id, name, issuer, authorize, token, keys string }
	for _, spec := range []metadata{
		{"google", "Google", "https://accounts.google.com", "https://accounts.google.com/o/oauth2/v2/auth", "https://oauth2.googleapis.com/token", "https://www.googleapis.com/oauth2/v3/certs"},
		{"apple", "Apple", "https://appleid.apple.com", "https://appleid.apple.com/auth/authorize", "https://appleid.apple.com/auth/token", "https://appleid.apple.com/auth/keys"},
	} {
		prefix := "AUTH_" + strings.ToUpper(spec.id)
		id, secret := os.Getenv(prefix+"_ID"), os.Getenv(prefix+"_SECRET")
		if id == "" && secret == "" {
			continue
		}
		if id == "" || secret == "" || len(a.secret) < 32 || os.Getenv("PUBLIC_URL") == "" {
			return nil, errors.New("OAuth requires PUBLIC_URL, AUTH_SECRET (32+ characters), and both provider values")
		}
		if spec.id == "apple" && (!a.secure || net.ParseIP(origin.Hostname()) != nil || origin.Hostname() == "localhost") {
			return nil, errors.New("Sign in with Apple requires an HTTPS domain")
		}
		scopes := []string{oidc.ScopeOpenID}
		if spec.id == "apple" {
			scopes = nil
		}
		ctx := oidc.ClientContext(context.Background(), a.client)
		a.providers[spec.id] = provider{Name: spec.name, config: oauth2.Config{
			ClientID: id, ClientSecret: secret, RedirectURL: a.origin + "/auth/callback/" + spec.id, Scopes: scopes,
			Endpoint: oauth2.Endpoint{AuthURL: spec.authorize, TokenURL: spec.token, AuthStyle: oauth2.AuthStyleInParams},
		}, verify: oidc.NewVerifier(spec.issuer, oidc.NewRemoteKeySet(ctx, spec.keys), &oidc.Config{ClientID: id, SupportedSigningAlgs: []string{"RS256"}})}
	}
	return a, nil
}

func (a *authentication) names() []string {
	names := make([]string, 0, 2)
	for _, key := range []string{"google", "apple"} {
		if _, ok := a.providers[key]; ok {
			names = append(names, key)
		}
	}
	return names
}

func (a *authentication) signature(name, payload string) []byte {
	h := hmac.New(sha256.New, a.secret)
	h.Write([]byte(name + "." + payload))
	return h.Sum(nil)
}

func (a *authentication) writeCookie(w http.ResponseWriter, name, path string, value any, age int, sameSite http.SameSite) {
	encoded := ""
	if value != nil {
		data, _ := json.Marshal(value)
		payload := base64.RawURLEncoding.EncodeToString(data)
		encoded = payload + "." + base64.RawURLEncoding.EncodeToString(a.signature(name, payload))
	}
	http.SetCookie(w, &http.Cookie{Name: name, Path: path, Value: encoded, MaxAge: age, HttpOnly: true, Secure: a.secure, SameSite: sameSite})
}

func (a *authentication) readCookie(r *http.Request, name string, value any) bool {
	cookie, err := r.Cookie(name)
	if err != nil || len(cookie.Value) > 2048 {
		return false
	}
	left, right, ok := strings.Cut(cookie.Value, ".")
	sig, err := base64.RawURLEncoding.DecodeString(right)
	if !ok || err != nil || !hmac.Equal(sig, a.signature(name, left)) {
		return false
	}
	data, err := base64.RawURLEncoding.DecodeString(left)
	return err == nil && json.Unmarshal(data, value) == nil
}

func (a *authentication) account(r *http.Request) *account {
	var session account
	if len(a.secret) < 32 || !a.readCookie(r, "terra-session", &session) ||
		session.Expires <= time.Now().Unix() || !accountFormat.MatchString(session.ID) {
		return nil
	}
	if _, ok := a.providers[session.Provider]; !ok {
		return nil
	}
	return &session
}

func randomToken() string {
	var bytes [32]byte
	rand.Read(bytes[:])
	return base64.RawURLEncoding.EncodeToString(bytes[:])
}

var signinHTML = template.Must(template.New("signin").Parse(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Вход в Терру</title><link rel="stylesheet" href="/style.css"></head><body><main><section class="card"><h1>Вход в Терру</h1><ul>{{range .}}<li><a href="/auth/start/{{.}}">Войти через {{if eq . "google"}}Google{{else}}Apple{{end}}</a></li>{{end}}</ul><a href="/">В игру</a></section></main></body></html>`))

func (a *authentication) signin(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	signinHTML.Execute(w, a.names())
}

func (a *authentication) start(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("provider")
	p, ok := a.providers[id]
	if !ok {
		http.NotFound(w, r)
		return
	}
	attempt := loginAttempt{State: randomToken(), Nonce: randomToken(), Expires: time.Now().Add(10 * time.Minute).Unix()}
	options := []oauth2.AuthCodeOption{oauth2.SetAuthURLParam("nonce", attempt.Nonce)}
	sameSite := http.SameSiteLaxMode
	if id == "google" {
		attempt.Verifier = oauth2.GenerateVerifier()
		options = append(options, oauth2.S256ChallengeOption(attempt.Verifier))
	} else {
		sameSite = http.SameSiteNoneMode
		options = append(options, oauth2.SetAuthURLParam("response_mode", "form_post"))
	}
	a.writeCookie(w, "terra-login-"+id, "/auth/callback/"+id, attempt, 600, sameSite)
	http.Redirect(w, r, p.config.AuthCodeURL(attempt.State, options...), http.StatusSeeOther)
}

func (a *authentication) callback(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("provider")
	p, ok := a.providers[id]
	if !ok || (id == "apple" && r.Method != "POST") || (id == "google" && r.Method != "GET") {
		http.NotFound(w, r)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 16*1024)
	if err := r.ParseForm(); err != nil {
		http.Error(w, "Некорректный ответ входа", 400)
		return
	}
	var attempt loginAttempt
	cookie := "terra-login-" + id
	if !a.readCookie(r, cookie, &attempt) || attempt.Expires <= time.Now().Unix() ||
		!hmac.Equal([]byte(attempt.State), []byte(r.Form.Get("state"))) || r.Form.Get("code") == "" {
		http.Error(w, "Не удалось подтвердить вход. Начни вход заново.", 400)
		return
	}
	a.writeCookie(w, cookie, "/auth/callback/"+id, nil, -1, http.SameSiteLaxMode)
	ctx, cancel := context.WithTimeout(oidc.ClientContext(r.Context(), a.client), 16*time.Second)
	defer cancel()
	options := []oauth2.AuthCodeOption{}
	if id == "google" {
		options = append(options, oauth2.VerifierOption(attempt.Verifier))
	}
	token, err := p.config.Exchange(ctx, r.Form.Get("code"), options...)
	if err != nil {
		http.Error(w, "Провайдер не подтвердил вход.", 400)
		return
	}
	raw, _ := token.Extra("id_token").(string)
	verified, err := p.verify.Verify(ctx, raw)
	if err != nil || verified.Subject == "" || !hmac.Equal([]byte(verified.Nonce), []byte(attempt.Nonce)) {
		http.Error(w, "Не удалось проверить аккаунт.", 400)
		return
	}
	identifier := sha256.Sum256([]byte(id + ":" + verified.Subject))
	a.writeCookie(w, "terra-session", "/", account{
		ID: hex.EncodeToString(identifier[:]), Name: p.Name, Provider: id, Expires: time.Now().Add(30 * 24 * time.Hour).Unix(),
	}, 30*24*60*60, http.SameSiteLaxMode)
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

func (a *authentication) signout(w http.ResponseWriter, r *http.Request) {
	if r.Method == "GET" {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte(`<!doctype html><html lang="ru"><meta charset="utf-8"><title>Выход из Терры</title><link rel="stylesheet" href="/style.css"><main><section class="card"><h1>Выйти из аккаунта?</h1><form method="post"><button class="button primary">Выйти</button></form><a href="/">В игру</a></section></main></html>`))
		return
	}
	if r.Method != "POST" || r.Header.Get("Origin") != a.origin {
		http.Error(w, "Forbidden", 403)
		return
	}
	a.writeCookie(w, "terra-session", "/", nil, -1, http.SameSiteLaxMode)
	http.Redirect(w, r, "/", http.StatusSeeOther)
}
