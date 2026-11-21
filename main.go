package main

import (
	"embed"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"time"
)

var (
	//go:embed dist
	bundle embed.FS
)

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(value)
}

func configuredPort() string {
	if value := os.Getenv("PORT"); value != "" {
		return value
	}
	return "3000"
}

func main() {
	port := configuredPort()
	if len(os.Args) == 2 && os.Args[1] == "healthcheck" {
		client := http.Client{Timeout: 2 * time.Second}
		response, err := client.Get("http://127.0.0.1:" + port + "/healthz")
		if err != nil {
			os.Exit(1)
		}
		response.Body.Close()
		if response.StatusCode != 200 {
			os.Exit(1)
		}
		return
	}
	if value, err := strconv.Atoi(port); err != nil || value < 1 || value > 65535 {
		log.Fatal("Invalid PORT")
	}
	public := os.Getenv("PUBLIC_URL")
	if public == "" {
		public = "http://localhost:" + port
	}
	origin, err := url.Parse(public)
	if err != nil || (origin.Scheme != "http" && origin.Scheme != "https") || origin.Host == "" ||
		origin.User != nil || origin.RawQuery != "" || origin.Fragment != "" || (origin.Path != "" && origin.Path != "/") {
		log.Fatal("PUBLIC_URL must be an HTTP or HTTPS origin")
	}
	auth, err := configureAuth(origin)
	if err != nil {
		log.Fatal(err)
	}
	web, err := fs.Sub(bundle, "dist")
	if err != nil {
		log.Fatal(err)
	}
	atlases, err := loadAtlasIDs(web)
	if err != nil {
		log.Fatal(err)
	}
	dir := os.Getenv("TERRA_DATA_DIR")
	if dir == "" {
		dir = "./data"
	}
	store, err := openStore(dir, storageCap, atlases)
	if err != nil {
		log.Fatal(err)
	}
	handler := routes(web, auth, store)
	server := http.Server{Addr: ":" + port, Handler: handler, ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout: 20 * time.Second, WriteTimeout: 25 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 16 * 1024}
	log.Printf("Terra listening on port %s", port)
	log.Fatal(server.ListenAndServe())
}

func routes(web fs.FS, auth *authentication, store *diskStore) http.Handler {
	mux := http.NewServeMux()
	// Keep simultaneous request bodies and OAuth exchanges bounded in a 50 MB container.
	requests := make(chan struct{}, 32)
	syncJobs := make(chan struct{}, 4)
	bounded := func(handler http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Cache-Control", "no-store")
			select {
			case syncJobs <- struct{}{}:
				defer func() { <-syncJobs }()
				handler(w, r)
			default:
				http.Error(w, "Сервер занят. Попробуй ещё раз.", 503)
			}
		}
	}
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) })
	mux.HandleFunc("GET /api/account", bounded(func(w http.ResponseWriter, r *http.Request) {
		session := auth.account(r)
		var latest *state
		if session != nil {
			var err error
			latest, err = store.get(session.ID)
			if err != nil {
				http.Error(w, "Хранилище недоступно", 500)
				return
			}
		}
		writeJSON(w, 200, map[string]any{"providers": auth.names(), "account": session, "data": latest})
	}))
	mux.HandleFunc("POST /api/progress", bounded(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Origin") != auth.origin {
			http.Error(w, "Forbidden", 403)
			return
		}
		session := auth.account(r)
		if session == nil {
			http.Error(w, "Unauthorized", 401)
			return
		}
		var input struct {
			AccountID string   `json:"accountId"`
			Changes   []change `json:"changes"`
		}
		r.Body = http.MaxBytesReader(w, r.Body, 384*1024)
		decoder := json.NewDecoder(r.Body)
		if err := decoder.Decode(&input); err != nil || decoder.Decode(new(any)) != io.EOF || len(input.Changes) == 0 || len(input.Changes) > 75 {
			http.Error(w, "Invalid request", 400)
			return
		}
		if input.AccountID != session.ID {
			http.Error(w, "Session changed", 409)
			return
		}
		for _, c := range input.Changes {
			if c.Type != "import" && c.Type != "reset" && c.Type != "solve" {
				http.Error(w, "Invalid change", 400)
				return
			}
		}
		latest, err := store.update(session.ID, input.Changes)
		if errors.Is(err, errStorageFull) {
			http.Error(w, "Хранилище заполнено", 507)
			return
		}
		if err != nil {
			http.Error(w, "Хранилище недоступно", 500)
			return
		}
		writeJSON(w, 200, latest)
	}))
	mux.HandleFunc("GET /auth/signin", bounded(auth.signin))
	mux.HandleFunc("GET /auth/start/{provider}", bounded(auth.start))
	mux.HandleFunc("GET /auth/callback/{provider}", bounded(auth.callback))
	mux.HandleFunc("POST /auth/callback/{provider}", bounded(auth.callback))
	mux.HandleFunc("GET /auth/signout", bounded(auth.signout))
	mux.HandleFunc("POST /auth/signout", bounded(auth.signout))
	static := http.FileServer(http.FS(web))
	mux.Handle("GET /", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/sw.js" || r.URL.Path == "/" {
			w.Header().Set("Cache-Control", "no-cache")
		}
		static.ServeHTTP(w, r)
	}))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		select {
		case requests <- struct{}{}:
			defer func() { <-requests }()
			mux.ServeHTTP(w, r)
		default:
			http.Error(w, "Сервер занят", 503)
		}
	})
}
