package main

import (
	"encoding/json"
	"io"
	"net/http"
	"sync"
)

// runStdin is the write end of the in-flight run's stdin pipe. It is nil when
// no run is active. POST /input writes one line here, so an interactive tool
// (a menu, a prompt, a REPL) can be answered over HTTP while it runs.
var (
	inputMu  sync.Mutex
	runStdin io.WriteCloser
)

func setRunStdin(w io.WriteCloser) {
	inputMu.Lock()
	runStdin = w
	inputMu.Unlock()
}

// handleInput sends {"text": "..."} to the running tool's stdin, followed by a
// newline. The line is also broadcast as an "input" frame so every live-feed
// viewer sees what was typed. 409 when no run is accepting input.
func (s *Server) handleInput(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "POST required"})
		return
	}
	var body struct {
		Text string `json:"text"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 64*1024)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "body must be {\"text\": \"...\"}"})
		return
	}
	inputMu.Lock()
	defer inputMu.Unlock()
	if runStdin == nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "no run is accepting input"})
		return
	}
	if _, err := io.WriteString(runStdin, body.Text+"\n"); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "write to tool stdin failed: " + err.Error()})
		return
	}
	s.broadcast(map[string]any{"type": "input", "text": body.Text})
	writeJSON(w, http.StatusOK, map[string]string{"state": "sent"})
}

// handleHistory returns every frame of the in-flight or most recent run, in
// order, as {"frames": [...]}. The MCP gateway reads it once the run ends.
func (s *Server) handleHistory(w http.ResponseWriter, r *http.Request) {
	s.clientsMu.Lock()
	frames := make([]json.RawMessage, 0, len(s.history))
	for _, msg := range s.history {
		frames = append(frames, json.RawMessage(msg))
	}
	s.clientsMu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"frames": frames})
}
