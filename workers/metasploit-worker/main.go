// __WORKER__ is a long-lived session worker. Unlike the run-to-completion
// workers, the tool starts on POST /run and keeps running (an interactive
// menu, a console, a REPL) until POST /stop or until the tool exits on its own.
// The live feed streams its output, and POST /input answers its prompts.
//
// Only one session runs at a time; a second /run is rejected with 409.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"sync"
	"syscall"
	"time"
)

// toolCommand is the executable on PATH inside the tool image. defaultArgs are
// always passed first; a /run request's args are appended after them.
const toolCommand = "msfconsole"

var defaultArgs = []string{"-q", "--no-readline"}

type runRequest struct {
	Args []string `json:"args"`
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
	argv := append(append([]string{}, defaultArgs...), req.Args...)
	go s.execute(ctx, argv)
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
	cancel()
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

	conn.ReadLoop() // blocks until the browser disconnects

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

func (s *Server) broadcastError(message string) {
	s.broadcast(map[string]any{"type": "error", "message": message})
}

// execute runs the tool until it exits or /stop cancels it, streaming every
// stdout/stderr line live. os/exec never invokes a shell: argv goes straight
// through, so the request body cannot inject commands.
func (s *Server) execute(ctx context.Context, argv []string) {
	defer func() {
		s.mu.Lock()
		s.state = stateIdle
		s.cancel = nil
		s.mu.Unlock()
	}()

	cmd := exec.CommandContext(ctx, toolCommand, argv...)
	cmd.Cancel = func() error { return cmd.Process.Signal(syscall.SIGTERM) }
	cmd.WaitDelay = 10 * time.Second
	stdin, err := cmd.StdinPipe()
	if err != nil {
		s.broadcastError("failed to attach stdin: " + err.Error())
		return
	}
	setRunStdin(stdin)
	defer setRunStdin(nil)
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
		s.broadcastError("failed to start " + toolCommand + ": " + err.Error())
		return
	}

	var wg sync.WaitGroup
	wg.Add(2)
	go s.streamLines(&wg, stdout, "stdout")
	go s.streamLines(&wg, stderr, "stderr")
	wg.Wait()

	waitErr := cmd.Wait()
	exitCode := 0
	if waitErr != nil {
		var exitErr *exec.ExitError
		if errors.As(waitErr, &exitErr) {
			exitCode = exitErr.ExitCode()
		} else {
			exitCode = -1
		}
	}
	s.broadcast(map[string]any{
		"type":     "result",
		"exitCode": exitCode,
		"worker":   "metasploit",
		"date":     time.Now().UTC().Format(time.RFC3339),
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
func (s *Server) streamLines(wg *sync.WaitGroup, r io.Reader, stream string) {
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
				s.broadcast(map[string]any{"type": "line", "stream": stream, "text": text})
				lastPartial, havePartial = "", false
			}
			if len(buf) > maxPendingBytes {
				text := string(buf)
				buf = buf[:0]
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
	if idx := bytes.LastIndexByte(buf, '\r'); idx != -1 {
		buf = buf[idx+1:]
	}
	if len(buf) > 0 {
		text := string(buf)
		s.broadcast(map[string]any{"type": "line", "stream": stream, "text": text})
	}
	buf = nil
	flushPartial(true)
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
	mux.HandleFunc("/input", server.handleInput)
	mux.HandleFunc("/history", server.handleHistory)
	mux.HandleFunc("/ws", server.handleWs)

	addr := ":" + getenv("METASPLOIT_WORKER_PORT", "8080")
	httpServer := &http.Server{Addr: addr, Handler: mux}
	go func() {
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("listen: %v", err)
		}
	}()
	log.Printf("metasploit session worker listening on %s", addr)

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig
	_ = httpServer.Shutdown(context.Background())
}
