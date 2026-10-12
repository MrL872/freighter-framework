// Tools with a real persistent-worker backend route, following the pattern of the subfinder worker: a
// com.example.application.<tool> backend package exposing
// POST /api/<tool>/run, POST /api/<tool>/stop, GET /api/<tool>/findings, and
// a WebSocket relay at /api/ws/<tool>; the tool's own -panel.js emitting
// `${tool}:flags` on the shared ctx bus; live-terminal.js emitting
// `${tool}:output` once a run completes. Every other worker still gets the
// inert live-terminal/send-output placeholders.
//
// nmap and dirsearch also run as persistent workers. nmap has a Go HTTP+WS server (workers/nmap-worker/main.go)
// wrapping the real nmap binary. dirsearch has a Python stdlib HTTP+WS server
// (workers/dirsearch-worker/server.py) wrapping the real dirsearch tool. Both use the same run/stream/findings
// pipeline.
//
// xsstrike/sqlmap/hydra/wpscan/sstimap/wafw00f/jwt-tool/fuxploider: backend
// packages (controller, flags, relay, run service, worker client) AND real
// workers/<tool>-worker/ HTTP+WS servers both exist, following this same
// run/stream/findings pipeline.
//
// jwt-tool's backend package is named `jwttool` (no hyphen -- Java package/
// class identifiers can't contain one), but every route, worker id, and
// Docker service name stays hyphenated ("jwt-tool") to match its actual CLI
// name -- see JwttoolController's @PostMapping("/jwt-tool/run") etc.
//
// masscan: masscan-worker's Go server (workers/masscan-worker/main.go) wraps the real masscan binary the
// same way nmap-worker does, run-to-completion, using masscan's own "masscan --nmap" flag reference (see
// MasscanFlags' class doc). It has no /output route, unlike nmap-worker, so its output-writing flags are
// plain value flags rather than isOutput.
//
// nosqlmap: the installed NoSQLMap build (/opt/NoSQLMap/nosqlmap.py) does have a real, non-interactive
// argparse CLI (--attack, --platform, --victim, ...) when --attack is given -- the "interactive menu only"
// assumption this comment made previously was checked against the actual binary and found to be wrong for
// this build. Falling back to its menu (mainMenu()) when --attack is omitted, or when a value it still
// needs wasn't supplied, is exactly what NosqlmapController's existing /input route (unchanged, kept wired
// since before this fix) is for.
//
// metasploit: msfconsole is a long-lived, interactive console, not a one-shot CLI process -- but
// metasploit-worker's Go server (workers/metasploit-worker/main.go) already implements the identical
// run/input/stop/ws contract every other worker here does (POST /run with interactive:true keeps stdin
// open), the same way hydra and sqlmap's own interactive prompts already flow through this pipeline. The
// control panel below only covers msfconsole's own launch flags (-q, -r, -x, ...); the actual console
// session -- `use`, `set`, `run`, `exploit`, search, and every other msfconsole command -- is typed into
// live-terminal.js's input box exactly like a sqlmap or hydra prompt. See MetasploitFlags' class doc.
export const WIRED_WORKERS = [
  'subfinder',
  'shuffledns',
  'gau',
  'gitleaks',
  'nuclei',
  'ffuf',
  'gowitness',
  'katana',
  'puredns',
  'nmap',
  'dirsearch',
  'xsstrike',
  'sqlmap',
  'hydra',
  'wpscan',
  'sstimap',
  'wafw00f',
  'jwt-tool',
  'fuxploider',
  'masscan',
  'nosqlmap',
  'metasploit',
];

/** The wired tool id for the worker currently open in the worker view, or null if this worker isn't wired (or none is open). */
export function currentWiredTool() {
  const worker = document.querySelector('main').dataset.worker || '';
  return WIRED_WORKERS.find(id => worker.startsWith(id)) || null;
}
