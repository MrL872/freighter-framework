package main

// Local-vs-cloud execution decision and job dispatch. The decision is driven
// entirely by Config -- never by anything specific to an individual worker's
// implementation -- so adding or changing a worker never requires touching this
// file.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sync"
	"time"
)

// Route records which path a job actually took, for observability -- callers
// (and the acceptance-criteria integration tests) can assert on this rather
// than inferring it from side effects.
type Route string

const (
	RouteLocal Route = "local"
	RouteCloud Route = "cloud"
)

type JobRequest struct {
	Worker         string   `json:"worker"`
	Args           []string `json:"args"`
	TimeoutSeconds int      `json:"timeoutSeconds,omitempty"`
}

type JobResult struct {
	Worker   string `json:"worker"`
	Route    Route  `json:"route"`
	State    string `json:"state"`
	Error    string `json:"error,omitempty"`
	Output   string `json:"output,omitempty"`
	ExitCode *int   `json:"exitCode,omitempty"`
}

// Gateway owns the HTTP client used for every outbound call to a worker or
// the cloud endpoint, and the loaded, validated configuration.
type Gateway struct {
	cfgPath  string
	client   *http.Client
	mu       sync.Mutex
	cfg      *Config
	cfgStamp time.Time
}

func NewGateway(cfg *Config, cfgPath string, loaded time.Time) *Gateway {
	return &Gateway{
		cfgPath:  cfgPath,
		cfg:      cfg,
		cfgStamp: loaded,
		client:   &http.Client{},
	}
}

// config returns the current configuration. When the config file has changed
// on disk since the last load, it is reloaded first. A file that fails to load
// (for example, half-written or invalid JSON) keeps the last good config, and
// the error is logged, so routing never drops to an empty table.
func (g *Gateway) config() *Config {
	g.mu.Lock()
	defer g.mu.Unlock()
	info, err := os.Stat(g.cfgPath)
	if err != nil || info.ModTime().Equal(g.cfgStamp) {
		return g.cfg
	}
	cfg, err := LoadConfig(g.cfgPath)
	if err != nil {
		log.Printf("config reload failed, keeping previous config: %v", err)
		g.cfgStamp = info.ModTime() // do not retry the same broken version on every request
		return g.cfg
	}
	g.cfg = cfg
	g.cfgStamp = info.ModTime()
	log.Printf("reloaded config from %s: %d worker(s)", g.cfgPath, len(cfg.Workers))
	return g.cfg
}

// Dispatch resolves the worker, makes the local-vs-cloud decision, and
// executes the job. It never panics outward and never returns an error that
// should crash the gateway process -- a failed worker or cloud call is
// reported in JobResult, not propagated as a fatal error .
func (g *Gateway) Dispatch(ctx context.Context, req JobRequest) (result JobResult) {
	result = JobResult{Worker: req.Worker}

	defer func() {
		if r := recover(); r != nil {
			result.State = "error"
			result.Error = fmt.Sprintf("internal gateway panic recovered: %v", r)
		}
	}()

	cfg := g.config()
	worker, ok := cfg.Workers[req.Worker]
	if !ok || !worker.IsEnabled() {
		result.State = "error"
		result.Error = fmt.Sprintf("unknown worker %q", req.Worker)
		return result
	}

	timeout := cfg.defaultTimeout()
	if req.TimeoutSeconds > 0 {
		timeout = time.Duration(req.TimeoutSeconds) * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	switch worker.Mode {
	case ModeLocal:
		return g.dispatchLocal(ctx, req, worker)
	case ModeCloud:
		return g.dispatchCloud(ctx, req, worker)
	case ModeAuto:
		res := g.dispatchLocal(ctx, req, worker)
		if res.State != "error" {
			return res
		}
		// Fall back to cloud only when the decision layer explicitly allows
		// it for this worker (mode "auto") and cloud is configured.
		cloudRes := g.dispatchCloud(ctx, req, worker)
		if cloudRes.State == "error" {
			cloudRes.Error = fmt.Sprintf("local failed (%s) and cloud fallback also failed: %s", res.Error, cloudRes.Error)
		}
		return cloudRes
	default:
		result.State = "error"
		result.Error = fmt.Sprintf("worker %q has invalid mode %q", req.Worker, worker.Mode)
		return result
	}
}

func (g *Gateway) dispatchLocal(ctx context.Context, req JobRequest, worker WorkerConfig) JobResult {
	result := JobResult{Worker: req.Worker, Route: RouteLocal}

	body, err := json.Marshal(map[string]any{"args": req.Args})
	if err != nil {
		result.State = "error"
		result.Error = "encoding worker request: " + err.Error()
		return result
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, worker.BaseURL+"/run", bytes.NewReader(body))
	if err != nil {
		result.State = "error"
		result.Error = "building worker request: " + err.Error()
		return result
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := g.client.Do(httpReq)
	if err != nil {
		result.State = "error"
		result.Error = "worker unreachable: " + err.Error()
		return result
	}
	defer resp.Body.Close()

	var decoded map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&decoded)

	if resp.StatusCode >= 300 {
		result.State = "error"
		if msg, ok := decoded["error"].(string); ok && msg != "" {
			result.Error = msg
		} else {
			result.Error = fmt.Sprintf("worker returned HTTP %d", resp.StatusCode)
		}
		return result
	}

	if state, ok := decoded["state"].(string); ok {
		result.State = state
	} else {
		result.State = "running"
	}
	if result.State == "running" {
		g.waitForRun(ctx, worker.BaseURL, &result)
	}
	return result
}

// dispatchCloud forwards the job to the configured cloud MCP endpoint. This
// still goes through the gateway's own routing, config validation, and (via
// the caller in main.go) request logging -- cloud routing never bypasses
// those controls .
func (g *Gateway) dispatchCloud(ctx context.Context, req JobRequest, worker WorkerConfig) JobResult {
	result := JobResult{Worker: req.Worker, Route: RouteCloud}

	if !g.config().Cloud.Enabled {
		result.State = "error"
		result.Error = "cloud execution is not enabled in gateway configuration"
		return result
	}

	body, err := json.Marshal(map[string]any{"worker": req.Worker, "args": req.Args})
	if err != nil {
		result.State = "error"
		result.Error = "encoding cloud request: " + err.Error()
		return result
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, g.config().Cloud.Endpoint+"/jobs", bytes.NewReader(body))
	if err != nil {
		result.State = "error"
		result.Error = "building cloud request: " + err.Error()
		return result
	}
	httpReq.Header.Set("Content-Type", "application/json")
	if apiKey := os.Getenv(g.config().Cloud.APIKeyEnv); apiKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	}

	resp, err := g.client.Do(httpReq)
	if err != nil {
		result.State = "error"
		result.Error = "cloud endpoint unreachable: " + err.Error()
		return result
	}
	defer resp.Body.Close()

	var decoded map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&decoded)

	if resp.StatusCode >= 300 {
		result.State = "error"
		if msg, ok := decoded["error"].(string); ok && msg != "" {
			result.Error = msg
		} else {
			result.Error = fmt.Sprintf("cloud endpoint returned HTTP %d", resp.StatusCode)
		}
		return result
	}

	if state, ok := decoded["state"].(string); ok {
		result.State = state
	} else {
		result.State = "running"
	}
	return result
}
