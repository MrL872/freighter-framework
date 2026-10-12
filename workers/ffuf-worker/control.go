package main

import (
	"net/http"
	"sync"
	"syscall"
	"time"
)

// Job control for the run in flight. These signals go to the tool's own process
// group, never to the container, and they match a shell's job control:
//   - /pause  is Ctrl+Z  (SIGTSTP): the job stops until it is resumed.
//   - /resume is fg      (SIGCONT): the stopped job continues.
//   - /stop   is Ctrl+C  (SIGINT):  the job is interrupted. The worker stays up and
//     goes idle, so the next run can start. SIGKILL is the fallback if the tool
//     still runs after stopGrace.
// execute starts the tool with Setpgid, so the group includes the tool's children.
var jobCtl struct {
	mu     sync.Mutex
	pgid   int    // process group of the running tool, 0 when none
	id     uint64 // counts runs, so a late fallback kill never hits a newer run
	paused bool
}

const stopGrace = 5 * time.Second

func setJobProcess(pid int) {
	jobCtl.mu.Lock()
	defer jobCtl.mu.Unlock()
	jobCtl.pgid = pid
	jobCtl.id++
	jobCtl.paused = false
}

func clearJobProcess() {
	jobCtl.mu.Lock()
	defer jobCtl.mu.Unlock()
	jobCtl.pgid = 0
	jobCtl.paused = false
}

// signalJob sends sig to the tool's process group. The caller holds jobCtl.mu.
func signalJob(sig syscall.Signal) bool {
	if jobCtl.pgid == 0 {
		return false
	}
	return syscall.Kill(-jobCtl.pgid, sig) == nil
}

func handlePause(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "POST required"})
		return
	}
	jobCtl.mu.Lock()
	defer jobCtl.mu.Unlock()
	if jobCtl.pgid == 0 {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "idle"})
		return
	}
	if jobCtl.paused {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "already paused"})
		return
	}
	if !signalJob(syscall.SIGTSTP) {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "job is not running"})
		return
	}
	jobCtl.paused = true
	writeJSON(w, http.StatusOK, map[string]string{"state": "paused"})
}

func handleResume(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "POST required"})
		return
	}
	jobCtl.mu.Lock()
	defer jobCtl.mu.Unlock()
	if !jobCtl.paused {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "not paused"})
		return
	}
	if !signalJob(syscall.SIGCONT) {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "job is not running"})
		return
	}
	jobCtl.paused = false
	writeJSON(w, http.StatusOK, map[string]string{"state": "running"})
}

// interruptJob is Ctrl+C. It reports false when no tool process is running.
func interruptJob() bool {
	jobCtl.mu.Lock()
	defer jobCtl.mu.Unlock()
	if jobCtl.pgid == 0 {
		return false
	}
	id := jobCtl.id
	// A stopped process holds SIGINT until it runs again, so continue it first,
	// the way fg is typed before Ctrl+C on a suspended job.
	signalJob(syscall.SIGCONT)
	jobCtl.paused = false
	signalJob(syscall.SIGINT)
	go func() {
		time.Sleep(stopGrace)
		jobCtl.mu.Lock()
		defer jobCtl.mu.Unlock()
		if jobCtl.pgid != 0 && jobCtl.id == id {
			syscall.Kill(-jobCtl.pgid, syscall.SIGKILL)
		}
	}()
	return true
}
