package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// pollInterval is how often the gateway checks a worker's /status while it
// waits for a run to end.
const pollInterval = 500 * time.Millisecond

// maxOutputBytes caps the output returned to the MCP client. The newest text
// is kept, because the end of a run is usually what matters.
const maxOutputBytes = 256 * 1024

// frame is the part of a worker's live-feed frame the gateway reads.
type frame struct {
	Type     string `json:"type"`
	Text     string `json:"text"`
	Message  string `json:"message"`
	ExitCode *int   `json:"exitCode"`
}

// waitForRun polls the worker until its run ends, then reads the run's frames
// into result.Output and result.ExitCode. If ctx expires first, it asks the
// worker to stop and returns what it has, with State "timeout".
func (g *Gateway) waitForRun(ctx context.Context, baseURL string, result *JobResult) {
	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			result.State = "timeout"
			stopCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			g.postWorker(stopCtx, baseURL+"/stop")
			g.readFrames(stopCtx, baseURL, result)
			return
		case <-ticker.C:
			if g.workerIdle(ctx, baseURL) {
				result.State = "completed"
				g.readFrames(ctx, baseURL, result)
				return
			}
		}
	}
}

// workerIdle reports whether the worker's /status says it has finished its run.
// A failed status call counts as not idle, so polling continues until ctx ends.
func (g *Gateway) workerIdle(ctx context.Context, baseURL string) bool {
	body, err := g.getWorker(ctx, baseURL+"/status")
	if err != nil {
		return false
	}
	var status struct {
		State string `json:"state"`
	}
	return json.Unmarshal(body, &status) == nil && status.State == "idle"
}

// readFrames reads the run's frames from /history and turns them into plain
// text: stdout and stderr lines, echoed input prefixed with "> ", and errors.
func (g *Gateway) readFrames(ctx context.Context, baseURL string, result *JobResult) {
	body, err := g.getWorker(ctx, baseURL+"/history")
	if err != nil {
		result.Error = "reading worker history: " + err.Error()
		return
	}
	var history struct {
		Frames []frame `json:"frames"`
	}
	if err := json.Unmarshal(body, &history); err != nil {
		result.Error = "decoding worker history: " + err.Error()
		return
	}
	var out strings.Builder
	for _, f := range history.Frames {
		switch f.Type {
		case "line":
			out.WriteString(f.Text + "\n")
		case "input":
			out.WriteString("> " + f.Text + "\n")
		case "error":
			out.WriteString("[error] " + f.Message + "\n")
		case "result":
			result.ExitCode = f.ExitCode
		}
	}
	text := out.String()
	if len(text) > maxOutputBytes {
		text = "[output truncated: showing the last 256 KB]\n" + text[len(text)-maxOutputBytes:]
	}
	result.Output = text
}

func (g *Gateway) getWorker(ctx context.Context, url string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := g.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 300 {
		return nil, fmt.Errorf("worker returned HTTP %d", resp.StatusCode)
	}
	return body, nil
}

func (g *Gateway) postWorker(ctx context.Context, url string) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, nil)
	if err != nil {
		return
	}
	if resp, err := g.client.Do(req); err == nil {
		resp.Body.Close()
	}
}
