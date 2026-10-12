// mcp-gateway is the execution and routing layer between client workloads
// (the frontend, over third-mcp-to-frontend-network) and MCP worker
// containers (over fourth-mcp-to-workers-network). It does no MCP-specific
// execution itself: each job is dispatched to the appropriate worker's
// existing HTTP API (see workers/subfinder-worker/main.go for the shared
// worker API shape) or, per configuration, to a cloud MCP endpoint.
package main

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func handleWorkers(gw *Gateway) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, gw.config().Workers)
	}
}

// handleJobs serves the /mcp/jobs endpoint. One failed or malformed job must
// never affect another in-flight request or crash the gateway -- each request already runs on its own goroutine
// via net/http, and Dispatch itself recovers from panics, so a bad job stays
// contained to its own HTTP response.
func handleJobs(gw *Gateway) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "POST required"})
			return
		}
		var req JobRequest
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
			return
		}
		if req.Worker == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "worker is required"})
			return
		}

		start := time.Now()
		result := gw.Dispatch(r.Context(), req)
		log.Printf("job worker=%s route=%s state=%s duration=%s", result.Worker, result.Route, result.State, time.Since(start))

		status := http.StatusAccepted
		if result.State == "error" {
			status = http.StatusBadGateway
		}
		writeJSON(w, status, result)
	}
}

func main() {
	configPath := getenv("MCP_GATEWAY_CONFIG", "/freighter-framework/data/config.json")

	cfg, err := LoadConfig(configPath)
	if err != nil {
		// Fail clearly on missing/invalid mandatory configuration rather
		// than starting with a broken or empty routing table.
		log.Fatalf("startup failed: %v", err)
	}
	log.Printf("loaded config from %s: %d worker(s) configured, cloud.enabled=%v", configPath, len(cfg.Workers), cfg.Cloud.Enabled)

	loadedAt := time.Time{}
	if info, err := os.Stat(configPath); err == nil {
		loadedAt = info.ModTime()
	}
	gw := NewGateway(cfg, configPath, loadedAt)

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", handleHealth)
	mux.HandleFunc("/mcp/workers", handleWorkers(gw))
	mux.HandleFunc("/mcp/jobs", handleJobs(gw))
	// Real Model Context Protocol (JSON-RPC 2.0 / Streamable HTTP) -- what
	// an actual MCP client (Claude Desktop, LM Studio, a local-LLM agent
	// framework, ...) adds as a server. See mcpprotocol.go's own module doc
	// for why this is a separate endpoint from /mcp/jobs above.
	mux.HandleFunc("/mcp", handleMCP(gw))

	addr := ":" + getenv("MCP_GATEWAY_PORT", "8811")
	httpServer := &http.Server{Addr: addr, Handler: mux}

	go func() {
		log.Printf("mcp-gateway listening on %s", addr)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("http server failed: %v", err)
		}
	}()

	// dumb-init (PID 1, see Dockerfile) forwards SIGTERM/SIGINT here on
	// `docker compose stop`/restart -- shut down cleanly rather than being
	// killed mid-request.
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
	<-sigCh
	log.Println("shutting down")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(ctx)
}
