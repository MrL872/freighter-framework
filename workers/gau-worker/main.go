// gau-worker is a persistent, long-running service wrapping the gau
// ("getallurls") CLI. It mirrors subfinder-worker/main.go's shape exactly:
// idle until the backend (GauRunService, via GauWorkerClient) asks it to
// run, streams output to every connected WebSocket subscriber live, and
// returns to idle once the gau process exits.
//
// Only one run is ever in flight at a time; a /run request while already
// running is rejected with 409 rather than queued.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"os/exec"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"
)

// Finding is the deliberately simple, non-authoritative translation of one
// discovered URL into the vulnerability ledger's row shape (see
// frontend/public/js/components/ledger.js's COLUMNS). gau only discovers
// historical URLs -- it has no notion of a vulnerability -- so this is a
// consistent placeholder mapping (severity "info", no port), not a real
// security assessment.
//
// Target is always a bare host (see hostOnly below) for consistency across
// every worker; Path keeps the full discovered URL gau's value actually
// lives in (e.g. archived parameters, old endpoints) -- collapsing that
// into Target instead would throw it away since there's nowhere else for
// it to go.
type Finding struct {
	Severity    string `json:"severity"`
	Target      string `json:"target"`
	Path        string `json:"path"`
	Port        string `json:"port"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Remediation string `json:"remediation"`
	Worker      string `json:"worker"`
	Date        string `json:"date"`
}

// hostOnly strips a URL's scheme, path, query and port so Target stays a
// bare host consistently across every worker, whatever shape the raw value
// originally had. Falls back to the raw value if it doesn't parse as a URL.
func hostOnly(raw string) string {
	v := strings.TrimSpace(raw)
	if v == "" {
		return v
	}
	candidate := v
	if !strings.Contains(candidate, "://") {
		candidate = "http://" + candidate
	}
	u, err := url.Parse(candidate)
	if err != nil || u.Hostname() == "" {
		return raw
	}
	return u.Hostname()
}

// portFor derives the port this finding's target was actually reached on:
// an explicit port in the URL if it has one, else the default for its
// scheme (80 for http, 443 for https), else 443 for a bare host with no
// scheme at all -- the same assumed-web default every scheme-less worker
// target gets.
func portFor(raw string) string {
	v := strings.TrimSpace(raw)
	if v == "" {
		return "443"
	}
	hasScheme := strings.Contains(v, "://")
	candidate := v
	if !hasScheme {
		candidate = "http://" + candidate
	}
	u, err := url.Parse(candidate)
	if err != nil {
		return "443"
	}
	if p := u.Port(); p != "" {
		return p
	}
	if !hasScheme || u.Scheme == "https" {
		return "443"
	}
	return "80"
}

type runState int

const (
	stateIdle runState = iota
	stateRunning
)

type Server struct {
	mu     sync.Mutex
	state  runState
	cancel context.CancelFunc

	clientsMu sync.Mutex
	clients   map[*WSConn]struct{}
	history   [][]byte
	// stream name ("stdout"/"stderr") -> index into history, present only
	// while that stream's latest history entry is a "partial" frame (see
	// broadcast and streamLines below) -- lets a stream's continuously
	// redrawn progress line collapse into one history slot instead of
	// growing one entry per redraw.
	partialSlots map[string]int
}

func NewServer() *Server {
	return &Server{clients: make(map[*WSConn]struct{})}
}

func (s *Server) status() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.state == stateRunning {
		return "running"
	}
	return "idle"
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"state": s.status()})
}

type runRequest struct {
	Args        []string `json:"args"`
	Interactive bool     `json:"interactive"`
}

func (s *Server) handleRun(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "POST required"})
		return
	}
	var req runRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}
	if len(req.Args) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "args is required"})
		return
	}

	s.mu.Lock()
	if s.state == stateRunning {
		s.mu.Unlock()
		writeJSON(w, http.StatusConflict, map[string]string{"error": "already running"})
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.state = stateRunning
	s.cancel = cancel
	s.mu.Unlock()

	s.resetHistory()
	go s.execute(ctx, req.Args, req.Interactive)
	writeJSON(w, http.StatusAccepted, map[string]string{"state": "running"})
}

func (s *Server) handleStop(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "POST required"})
		return
	}
	s.mu.Lock()
	cancel := s.cancel
	running := s.state == stateRunning
	s.mu.Unlock()
	if !running || cancel == nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "idle"})
		return
	}
	interruptJob()
	writeJSON(w, http.StatusOK, map[string]string{"state": "stopping"})
}

func (s *Server) handleWs(w http.ResponseWriter, r *http.Request) {
	conn, err := Upgrade(w, r)
	if err != nil {
		log.Printf("ws upgrade failed: %v", err)
		return
	}
	s.clientsMu.Lock()
	s.clients[conn] = struct{}{}
	for _, msg := range s.history {
		_ = conn.WriteText(msg)
	}
	s.clientsMu.Unlock()

	conn.ReadLoop()

	s.clientsMu.Lock()
	delete(s.clients, conn)
	s.clientsMu.Unlock()
}

func (s *Server) resetHistory() {
	s.clientsMu.Lock()
	s.history = nil
	s.partialSlots = nil
	s.clientsMu.Unlock()
}

// broadcast sends msg to every connected client and appends it to the
// replay history -- except a "partial" frame (see streamLines: the
// not-yet-newline-terminated tail of a stream, e.g. a progress bar
// mid-redraw) replaces that stream's last partial in place rather than
// growing the history by one entry per redraw.
func (s *Server) broadcast(msg map[string]any) {
	data, err := json.Marshal(msg)
	if err != nil {
		log.Printf("broadcast marshal failed: %v", err)
		return
	}
	isPartial := msg["type"] == "partial"
	stream, _ := msg["stream"].(string)

	s.clientsMu.Lock()
	if idx, ok := s.partialSlots[stream]; isPartial && ok {
		s.history[idx] = data
	} else {
		if s.partialSlots != nil {
			delete(s.partialSlots, stream)
		}
		s.history = append(s.history, data)
		if isPartial {
			if s.partialSlots == nil {
				s.partialSlots = make(map[string]int)
			}
			s.partialSlots[stream] = len(s.history) - 1
		}
	}
	for conn := range s.clients {
		_ = conn.WriteText(data)
	}
	s.clientsMu.Unlock()
}

// execute runs gau to completion (or cancellation), streaming each
// stdout/stderr line to every connected client as it's produced, then
// broadcasts the final result frame and returns the worker to idle. os/exec
// never invokes a shell here -- args is passed straight through as argv, so
// there's no command-injection surface regardless of what the backend
// forwarded (this includes gau's bare positional target argument -- see
// GauFlags on the backend side, which validates it same as any flag value).
func (s *Server) execute(ctx context.Context, args []string, interactive bool) {
	defer func() {
		s.mu.Lock()
		s.state = stateIdle
		s.cancel = nil
		s.mu.Unlock()
	}()

	cmd := exec.CommandContext(ctx, "gau", args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if interactive {
		stdin, err := cmd.StdinPipe()
		if err != nil {
			s.broadcastError("failed to attach stdin: " + err.Error())
			return
		}
		setRunStdin(stdin)
		defer setRunStdin(nil)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		s.broadcastError("failed to attach stdout: " + err.Error())
		return
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		s.broadcastError("failed to attach stderr: " + err.Error())
		return
	}

	if err := cmd.Start(); err != nil {
		s.broadcastError("failed to start gau: " + err.Error())
		return
	}
	setJobProcess(cmd.Process.Pid)

	var lines []string
	var linesMu sync.Mutex
	var wg sync.WaitGroup
	wg.Add(2)
	go s.streamLines(&wg, stdout, "stdout", &lines, &linesMu)
	go s.streamLines(&wg, stderr, "stderr", &lines, &linesMu)
	wg.Wait()

	waitErr := cmd.Wait()
	clearJobProcess()
	exitCode := 0
	if waitErr != nil {
		var exitErr *exec.ExitError
		if errors.As(waitErr, &exitErr) {
			exitCode = exitErr.ExitCode()
		} else {
			exitCode = -1
		}
	}

	findings := translateFindings(lines)
	s.broadcast(map[string]any{
		"type":     "result",
		"exitCode": exitCode,
		"worker":   "gau",
		"date":     time.Now().UTC().Format(time.RFC3339),
		"findings": findings,
	})
}

// partialThrottle bounds how often an in-progress (not yet newline-terminated)
// line is broadcast -- a tool redrawing a progress bar on every byte would
// otherwise flood every connected client and the replay history with updates
// far faster than anyone can read them. Never applied to the frame that
// clears a partial back to "", so the live line never visibly lags behind a
// run actually finishing.
const partialThrottle = 100 * time.Millisecond

// maxPendingBytes bounds how large the not-yet-terminated buffer can grow --
// the same protection bufio.Scanner's own fixed max-token-size gave the
// previous, scanner-based version of this function, so a tool that emits an
// extremely long line (or none at all) still can't grow this unboundedly.
const maxPendingBytes = 4 << 20 // 4MB

// streamLines reads r (the tool's stdout or stderr) in raw chunks and
// broadcasts it live, rather than using bufio.Scanner's line-oriented
// ScanLines (the previous approach here): some tools, when their stdout
// isn't a tty (as a subprocess pipe never is), redraw a progress indicator
// with no separator at all -- no '\r', no '\n' -- so a '\n'-seeking scanner
// just blocks accumulating the entire run's progress spam, then suddenly
// emits it as one giant line the moment the next real newline arrives. That
// produced both a frozen-then-bursty feed and, on tools that DO use a bare
// '\r' to redraw, extra blank-looking lines wherever a redraw happened to
// land. Each chunk is scanned by hand for '\n' (a finished line, broadcast
// as "line", permanent) and '\r' (an in-place overwrite -- the text before
// it is discarded, exactly like a real terminal's cursor return, and never
// broadcast). Whatever's left after the last boundary is the current,
// still-growing line; it's broadcast as "partial" so the frontend can show
// it updating live instead of only ever seeing finished lines.
func (s *Server) streamLines(wg *sync.WaitGroup, r io.Reader, stream string, lines *[]string, mu *sync.Mutex) {
	defer wg.Done()
	var buf []byte
	chunk := make([]byte, 4096)
	var lastPartial string
	havePartial := false
	var lastEmit time.Time

	flushPartial := func(force bool) {
		// A trailing '\r' here is still ambiguous (the inner loop above
		// left it for the next read to resolve, in case it turns out to be
		// half of a split '\r\n') -- hide it from what's displayed so a
		// bare carriage return never flashes as visible text while we wait
		// to find out.
		display := buf
		if n := len(display); n > 0 && display[n-1] == '\r' {
			display = display[:n-1]
		}
		text := string(display)
		if havePartial && text == lastPartial {
			return
		}
		if !havePartial && text == "" {
			return
		}
		if !force && text != "" && time.Since(lastEmit) < partialThrottle {
			return
		}
		s.broadcast(map[string]any{"type": "partial", "stream": stream, "text": text})
		lastPartial = text
		havePartial = true
		lastEmit = time.Now()
	}

	for {
		n, err := r.Read(chunk)
		if n > 0 {
			buf = append(buf, chunk[:n]...)
			for {
				nl := bytes.IndexByte(buf, '\n')
				cr := bytes.IndexByte(buf, '\r')
				if nl == -1 && cr == -1 {
					break
				}
				var line []byte
				if cr != -1 && (nl == -1 || cr < nl) {
					if cr == len(buf)-1 {
						break // might be a \r\n split across reads -- wait for the rest
					}
					if buf[cr+1] == '\n' {
						line, buf = buf[:cr], buf[cr+2:]
					} else {
						buf = buf[cr+1:] // bare \r: discard what it overwrote, not a line
						continue
					}
				} else {
					line, buf = buf[:nl], buf[nl+1:]
				}
				text := string(line)
				mu.Lock()
				*lines = append(*lines, text)
				mu.Unlock()
				s.broadcast(map[string]any{"type": "line", "stream": stream, "text": text})
				lastPartial, havePartial = "", false
			}
			if len(buf) > maxPendingBytes {
				text := string(buf)
				buf = buf[:0]
				mu.Lock()
				*lines = append(*lines, text)
				mu.Unlock()
				s.broadcast(map[string]any{"type": "line", "stream": stream, "text": text})
				lastPartial, havePartial = "", false
			} else {
				flushPartial(false)
			}
		}
		if err != nil {
			break
		}
	}
	// A trailing bare '\r' reset is still meaningful even here at EOF (the
	// tool's last write before closing its pipe is often exactly this, e.g.
	// a final unresolved progress-bar redraw) -- keep only what follows the
	// last one, same as the live loop above, instead of dumping the whole
	// accumulated-and-overwritten buffer as one garbled line.
	if idx := bytes.LastIndexByte(buf, '\r'); idx != -1 {
		buf = buf[idx+1:]
	}
	if len(buf) > 0 {
		text := string(buf)
		mu.Lock()
		*lines = append(*lines, text)
		mu.Unlock()
		s.broadcast(map[string]any{"type": "line", "stream": stream, "text": text})
	}
	buf = nil
	flushPartial(true)
}

func (s *Server) broadcastError(message string) {
	s.broadcast(map[string]any{"type": "error", "message": message})
}

// translateFindings is the one, deliberately simple place that turns raw gau
// output into vulnerability-ledger rows (see Finding above). gau's plain
// mode prints one discovered URL per line; with --json it instead emits one
// JSON object per line ({"url":"...",...}). Both shapes are handled the same
// way: extract a URL string, or skip the line if it's neither.
func translateFindings(lines []string) []Finding {
	now := time.Now().UTC().Format(time.RFC3339)
	findings := make([]Finding, 0, len(lines))
	for _, raw := range lines {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}
		urlValue := line
		if strings.HasPrefix(line, "{") {
			var obj map[string]any
			if err := json.Unmarshal([]byte(line), &obj); err != nil {
				continue
			}
			u, _ := obj["url"].(string)
			if u == "" {
				continue
			}
			urlValue = u
		} else if strings.ContainsAny(line, " \t") {
			continue // banner/log text, not a bare URL
		}
		findings = append(findings, Finding{
			Severity:    "info",
			Target:      hostOnly(urlValue),
			Path:        urlValue,
			Port:        portFor(urlValue),
			Title:       "URL discovered",
			Description: "Discovered via gau",
			Remediation: "",
			Worker:      "gau",
			Date:        now,
		})
	}
	return findings
}

// outputDir is the fixed, in-container directory an isOutput flag's
// value is rewritten to point at before a run (see the backend's
// gauRunService.start() / WorkerOutputStager) -- never a path on the
// host. handleOutput below serves files back out of this same directory
// once a run completes, for the backend to stage into the profile's real
// Project Folder.
const outputDir = "/tmp/output"

func (s *Server) handleOutput(w http.ResponseWriter, r *http.Request) {
	name := filepath.Base(r.URL.Query().Get("name"))
	if name == "" || name == "." || name == string(filepath.Separator) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name is required"})
		return
	}
	data, err := os.ReadFile(filepath.Join(outputDir, name))
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "no such output file"})
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Write(data)
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func main() {
	if err := os.MkdirAll(outputDir, 0o755); err != nil {
		log.Fatalf("failed to create output directory: %v", err)
	}

	server := NewServer()
	mux := http.NewServeMux()
	mux.HandleFunc("/health", server.handleHealth)
	mux.HandleFunc("/status", server.handleStatus)
	mux.HandleFunc("/run", server.handleRun)
	mux.HandleFunc("/stop", server.handleStop)
	mux.HandleFunc("/pause", handlePause)
	mux.HandleFunc("/resume", handleResume)
	mux.HandleFunc("/input", server.handleInput)
	mux.HandleFunc("/history", server.handleHistory)
	mux.HandleFunc("/ws", server.handleWs)
	mux.HandleFunc("/output", server.handleOutput)

	addr := ":" + getenv("GAU_WORKER_PORT", "8080")
	httpServer := &http.Server{Addr: addr, Handler: mux}

	go func() {
		log.Printf("gau-worker listening on %s", addr)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("http server failed: %v", err)
		}
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
	<-sigCh
	log.Println("shutting down")

	server.mu.Lock()
	if server.cancel != nil {
		server.cancel()
	}
	server.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(ctx)
}
