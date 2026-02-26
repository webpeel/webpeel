package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"sync/atomic"
	"time"
)

const version = "1.0.0"

var (
	startTime    = time.Now()
	requestCount int64
)

func main() {
	port := flag.Int("port", 8787, "Port to listen on (0 = random)")
	token := flag.String("token", "", "Authorization token")
	flag.Parse()

	if *token == "" {
		log.Fatal("--token is required")
	}

	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *port))
	if err != nil {
		log.Fatalf("Failed to listen: %v", err)
	}

	actualPort := listener.Addr().(*net.TCPAddr).Port

	mux := http.NewServeMux()
	mux.HandleFunc("/fetch", authMiddleware(*token, handleFetch))
	mux.HandleFunc("/health", authMiddleware(*token, handleHealth))
	mux.HandleFunc("/shutdown", authMiddleware(*token, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"shutting down"}`))
		go func() {
			time.Sleep(100 * time.Millisecond)
			// Graceful shutdown
			srv.Shutdown(context.Background())
		}()
	}))

	srv = &http.Server{Handler: mux}

	// Print ready signal BEFORE accepting connections
	info := map[string]interface{}{
		"port":  actualPort,
		"token": *token,
	}
	data, _ := json.Marshal(info)
	fmt.Println(string(data))

	if err := srv.Serve(listener); err != nil && err != http.ErrServerClosed {
		log.Fatalf("Server error: %v", err)
	}
}

var srv *http.Server

func authMiddleware(token string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		auth := r.Header.Get("Authorization")
		expected := "Bearer " + token
		if auth != expected {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			w.Write([]byte(`{"error":"unauthorized"}`))
			return
		}
		atomic.AddInt64(&requestCount, 1)
		w.Header().Set("Content-Type", "application/json")
		next(w, r)
	}
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	uptime := time.Since(startTime).Seconds()
	resp := map[string]interface{}{
		"status":   "ok",
		"version":  version,
		"uptime":   uptime,
		"requests": atomic.LoadInt64(&requestCount),
	}
	json.NewEncoder(w).Encode(resp)
}

func handleFetch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req FetchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "invalid request body: " + err.Error()})
		return
	}

	result := doFetch(req)
	json.NewEncoder(w).Encode(result)
}
