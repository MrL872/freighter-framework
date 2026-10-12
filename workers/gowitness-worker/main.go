// gowitness-worker is a persistent, long-running service wrapping the
// gowitness CLI. It mirrors subfinder-worker's architecture exactly (see
// that worker's main.go for the full rationale): idle until the backend
// (GowitnessRunService, via GowitnessWorkerClient) asks it to run, streams
// the resulting output to every connected WebSocket subscriber live, and
// returns to idle once the gowitness process exits.
//
// Only one run is ever in flight at a time; a /run request while already
// running is rejected with 409 rather than queued.
//
// DESIGN DECISION -- screenshot delivery (see the module comment block
// further down, above screenshotFrames, for the full reasoning): gowitness
// is fundamentally different from the other three tools this worker mirrors
// -- its useful output is screenshot IMAGE files, not vulnerability-shaped
// text. This worker emits one
// {"type":"screenshot","url":...,"target":...,"endpoint":...,"data":"<base64>"}
// WS frame per screenshot file gowitness wrote during the run, in addition
// to a findings entry per screenshot for ledger visibility. The backend
// relay (GowitnessRelayHandler) forwards these frames like any other. The
// base64 image bytes are not persisted into Image Storage by this worker;
// the backend/frontend side owns that step, using "target" to decide which
// per-target folder a screenshot belongs in and "endpoint" to show the real
// URL it was captured from -- see readJSONLReport/emitScreenshots for how
// those two fields get resolved from gowitness's own --write-jsonl report.
package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
)

// Finding is the deliberately simple, non-authoritative translation of one
// gowitness screenshot into the vulnerability ledger's row shape (see
// frontend/public/js/components/ledger.js's COLUMNS). gowitness only takes
// screenshots -- it has no notion of a vulnerability, and unlike the other
// three tools this worker mirrors, its primary output isn't even text -- so
// this row exists purely so the ledger shows *that* a screenshot exists,
// not a real security assessment. Port and StatusCode are resolved from
// gowitness's own --write-jsonl report (see readJSONLReport/emitScreenshots/
// portFor) -- both left unset (StatusCode via its omitempty tag, Port as "")
// when a screenshot is missing from that report, same "unresolved" fallback
// as Target/Path already use.
type Finding struct {
	Severity    string `json:"severity"`
	Target      string `json:"target"`
	Path        string `json:"path"`
	Port        string `json:"port"`
	StatusCode  int    `json:"statusCode,omitempty"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Remediation string `json:"remediation"`
	Version     string `json:"version,omitempty"`
	Worker      string `json:"worker"`
	Date        string `json:"date"`
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

// execute runs gowitness to completion (or cancellation), streaming each
// stdout/stderr line to every connected client as it's produced, then
// emitting one screenshot frame per image file gowitness wrote, then
// broadcasting the final result frame and returning the worker to idle.
// os/exec never invokes a shell here -- args is passed straight through as
// argv, so there's no command-injection surface regardless of what the
// backend forwarded.
func (s *Server) execute(ctx context.Context, args []string, interactive bool) {
	defer func() {
		s.mu.Lock()
		s.state = stateIdle
		s.cancel = nil
		s.mu.Unlock()
	}()

	screenshotDir, hasDir := screenshotDirFromArgs(args)
	var before map[string]time.Time
	if hasDir {
		before = listImageFiles(screenshotDir)
	}

	// Asks gowitness for its own --write-jsonl report on every run, reusing
	// the user's own --write-jsonl-file path (WRITERS section) if they set
	// one, else writing to a worker-private path. emitScreenshots reads this
	// back after the run to resolve each screenshot's real URL -- see
	// readJSONLReport's own doc comment for why this exists.
	jsonlPath := jsonlReportPathFromArgs(args)
	if jsonlPath == "" {
		jsonlPath = filepath.Join(os.TempDir(), ".gowitness-report.jsonl")
		args = append(args, "--write-jsonl", "--write-jsonl-file", jsonlPath)
	} else {
		hasEnable := false
		for _, a := range args {
			if a == "--write-jsonl" {
				hasEnable = true
				break
			}
		}
		if !hasEnable {
			args = append(args, "--write-jsonl")
		}
	}

	cmd := exec.CommandContext(ctx, "gowitness", args...)
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
		s.broadcastError("failed to start gowitness: " + err.Error())
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

	report := readJSONLReport(jsonlPath)
	var findings []Finding
	if hasDir {
		findings = s.emitScreenshots(screenshotDir, before, report)
	} else {
		findings = []Finding{}
	}

	s.broadcast(map[string]any{
		"type":     "result",
		"exitCode": exitCode,
		"worker":   "gowitness",
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

// jsonlReportEntry is one line of gowitness's own --write-jsonl report.
// gowitness's real schema has many more fields (headers, TLS, ...) -- only
// the ones readJSONLReport/emitScreenshots actually use are declared here.
//
// Technologies is gowitness's Wappalyzer-based tech detection, confirmed
// live against a real scan: each entry's Value is either a bare product
// name ("Bootstrap", "Ubuntu") or "Product:Version" when a version was
// actually detected (e.g. "Apache HTTP Server:2.4.41") -- there is no
// separate structured version field, so technologyVersion below has to
// split on that colon itself.
type jsonlReportEntry struct {
	URL          string `json:"url"`
	FinalURL     string `json:"final_url"`
	FileName     string `json:"file_name"`
	ResponseCode int    `json:"response_code"`
	Technologies []struct {
		Value string `json:"value"`
	} `json:"technologies"`
}

// technologyVersion returns the first "Product:Version" entry's version
// half (e.g. "2.4.41" from "Apache HTTP Server:2.4.41"), or "" when none of
// entry's detected technologies carried a version at all (most don't --
// e.g. "Bootstrap", "Ubuntu" are bare names with no colon).
func technologyVersion(entry jsonlReportEntry) string {
	for _, tech := range entry.Technologies {
		if _, version, ok := strings.Cut(tech.Value, ":"); ok && version != "" {
			return version
		}
	}
	return ""
}

// jsonlReportPathFromArgs returns the user's own --write-jsonl-file value,
// if GowitnessFlags' WRITERS section set one, so execute() reuses that path
// instead of asking gowitness to write a second report.
func jsonlReportPathFromArgs(args []string) string {
	for i := 0; i < len(args); i++ {
		if args[i] == "--write-jsonl-file" && i+1 < len(args) {
			return args[i+1]
		}
	}
	return ""
}

// readJSONLReport parses gowitness's --write-jsonl output into a
// file_name -> entry map, resolving each screenshot's real crawled URL
// (see emitScreenshots). Best-effort: a missing or malformed report (the
// run failed before writing one, gowitness wrote nothing because it found
// no targets, ...) just means emitScreenshots falls back to the screenshot
// file's own name -- never a reason to fail the run over it.
func readJSONLReport(path string) map[string]jsonlReportEntry {
	report := make(map[string]jsonlReportEntry)
	data, err := os.ReadFile(path)
	if err != nil {
		return report
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var entry jsonlReportEntry
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			continue // one malformed line shouldn't drop the rest of the report
		}
		if entry.FileName == "" {
			continue
		}
		report[entry.FileName] = entry
	}
	return report
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

// hostOf extracts the bare hostname from a URL, for Image Storage's
// per-target folder name -- "" (unresolved) on anything that doesn't parse
// as a URL with a host, e.g. an empty string.
func hostOf(rawURL string) string {
	if rawURL == "" {
		return ""
	}
	u, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}
	return u.Hostname()
}

// portFor derives the port a screenshot's resolved endpoint was reached on:
// an explicit port in the URL if it has one, else the default for its
// scheme (80 for http, 443 for https). Unlike hostOf, "" in means "" out --
// endpoint is already a full URL with a scheme when it's set at all (see
// emitScreenshots), so there's no bare-host case to assume a default for;
// a blank endpoint just means the report didn't resolve this screenshot,
// same unresolved case hostOf returns "" for.
func portFor(rawURL string) string {
	if rawURL == "" {
		return ""
	}
	u, err := url.Parse(rawURL)
	if err != nil || u.Hostname() == "" {
		return ""
	}
	if p := u.Port(); p != "" {
		return p
	}
	switch u.Scheme {
	case "https":
		return "443"
	case "http":
		return "80"
	default:
		return ""
	}
}

// screenshotDirFromArgs looks for gowitness's own screenshot-path flag
// (-s/--screenshot-path in gowitness's "scan" subcommands) in the validated
// argv. Returns ("", false) if the run didn't specify one -- callers then
// skip screenshot emission entirely rather than guessing a default.
func screenshotDirFromArgs(args []string) (string, bool) {
	for i := 0; i < len(args); i++ {
		if (args[i] == "-s" || args[i] == "--screenshot-path") && i+1 < len(args) {
			return args[i+1], true
		}
	}
	return "", false
}

// listImageFiles maps each screenshot file in dir to its mtime, not just its
// name. gowitness names a screenshot by a sanitized, collapsed form of its
// target URL that two different targets can land on (see emitScreenshots'
// own doc comment for how the real URL is recovered despite this), so
// re-scanning a target already screenshotted earlier in this container's
// life reuses the exact same file name -- a present-before/present-after
// name check alone would then see the file both before and after this run
// and conclude nothing new was captured, even though gowitness just
// overwrote it with a fresh image. Keeping the mtime lets emitScreenshots
// tell "unchanged leftover" apart from "overwritten by this run" for the
// same name.
func listImageFiles(dir string) map[string]time.Time {
	set := make(map[string]time.Time)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return set
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		if !isImageFile(e.Name()) {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		set[e.Name()] = info.ModTime()
	}
	return set
}

func isImageFile(name string) bool {
	ext := strings.ToLower(filepath.Ext(name))
	return ext == ".png" || ext == ".jpg" || ext == ".jpeg"
}

// emitScreenshots is the module's one place turning gowitness's screenshot
// files into both WS "screenshot" frames (raw base64 image bytes, for
// whatever eventually consumes them -- see the DESIGN DECISION comment at
// the top of this file) and ledger Finding rows (metadata only, so the
// ledger shows a screenshot exists even though it has no image column).
//
// gowitness names its screenshot files by a sanitized, collapsed form of
// the target URL -- not reliably enough to recover the real URL from the
// name alone (two different targets, or the same target with a different
// path, can collapse to the same or a barely-different name). report (see
// readJSONLReport) is gowitness's own --write-jsonl output, which carries
// the real file_name <-> url mapping for every probe; report[name] resolves
// "target" (bare host, for Image Storage's per-target folder) and
// "endpoint" (the real crawled URL, for display) for each screenshot frame,
// plus the Finding's Port (derived from endpoint via portFor) and
// StatusCode (the probe's response_code) below. A screenshot missing from
// report (the report failed to write, or an older gowitness without this
// field) falls back to the file name alone for Path, and leaves Port/
// StatusCode unresolved, same as before this worker could read the real
// URL back out.
func (s *Server) emitScreenshots(dir string, before map[string]time.Time, report map[string]jsonlReportEntry) []Finding {
	now := time.Now().UTC().Format(time.RFC3339)
	after := listImageFiles(dir)
	var findings []Finding
	for name, mtime := range after {
		// Skip only a file this run definitely didn't touch: same name, same
		// mtime as before the run started. A re-scan that overwrites an
		// existing name gets a newer mtime and is still reported -- see the
		// listImageFiles comment above.
		if prior, existed := before[name]; existed && !mtime.After(prior) {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			continue
		}
		var endpoint, target, version string
		var statusCode int
		if entry, ok := report[name]; ok {
			endpoint = firstNonEmpty(entry.FinalURL, entry.URL)
			target = hostOf(endpoint)
			statusCode = entry.ResponseCode
			version = technologyVersion(entry)
		}
		s.broadcast(map[string]any{
			"type":     "screenshot",
			"url":      name,     // the screenshot's own file name -- Image Storage's on-disk id, not a display path
			"target":   target,   // bare host for Image Storage's per-target folder -- "" when unresolved
			"endpoint": endpoint, // the real crawled URL for display -- "" when unresolved
			"data":     base64.StdEncoding.EncodeToString(data),
		})
		path := endpoint
		if path == "" {
			path = name // unresolved -- same fallback this worker always used before report existed
		}
		findings = append(findings, Finding{
			Severity:    "info",
			Target:      target,
			Path:        path,
			Port:        portFor(endpoint),
			StatusCode:  statusCode,
			Title:       "Screenshot captured",
			Description: "gowitness captured a screenshot (see the live stream's screenshot frame for the image; file: " + name + ")",
			Remediation: "",
			Version:     version,
			Worker:      "gowitness",
			Date:        now,
		})
	}
	if findings == nil {
		findings = []Finding{}
	}
	return findings
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

	addr := ":" + getenv("GOWITNESS_WORKER_PORT", "8080")
	httpServer := &http.Server{Addr: addr, Handler: mux}

	go func() {
		log.Printf("gowitness-worker listening on %s", addr)
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
