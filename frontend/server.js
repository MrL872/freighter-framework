// Frontend Express server. Serves public/, proxies /api/* to the backend (BACKEND_URL) with the /api prefix
// removed, relays WebSocket upgrades, hosts /search-direct for the ledger's Elasticsearch search, and hosts
// /manual for the header's Documentation window (js/components/documentation.js).
const path = require('path');
const fs = require('fs');
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const PORT = process.env.PORT || 3000;
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8080';
// MANUAL.md lives at the project root, outside this container's build
// context (frontend/), so it only exists here through the bind mount
// docker-compose.yml sets up at this path. Locally (no Docker), the default
// resolves one directory up from this file, which is the project root.
const MANUAL_PATH = process.env.MANUAL_PATH || path.join(__dirname, '..', 'MANUAL.md');

const app = express();

function log(event, fields) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));
}

app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    log('request', { method: req.method, path: req.path, status: res.statusCode, durationMs: Math.round(durationMs) });
  });
  next();
});

// Forward API calls to the Spring Boot backend so the browser only ever talks to this origin.
const apiProxy = createProxyMiddleware({
    target: BACKEND_URL,
    changeOrigin: true,
    pathRewrite: { '^/api': '' },
    // Must stay comfortably above every backend-side HTTP timeout this proxy
    // sits in front of, or this proxy's own generic "backend unreachable"
    // wins the race against the backend's own, more specific error/response
    // -- the slowest such call is a local-model chat completion, capped at
    // 10 minutes in OpenAiCompatibleLlmClient.java (Anthropic's is 5
    // minutes; fetch-models is 10 seconds), so this is set well above that.
    proxyTimeout: 11 * 60 * 1000,
    timeout: 11 * 60 * 1000,
    // Needed for /api/ws/subfinder (live-terminal.js's live stream, relayed
    // by the backend -- see SubfinderRelayHandler): http-proxy-middleware
    // doesn't upgrade WebSocket connections by default.
    ws: true,
    onError(err, req, res) {
        log('proxy:error', { path: req.path, message: err.message });
        res.status(502).json({ error: 'backend unreachable' });
    },
});
app.use('/api', apiProxy);

// Read-only Elasticsearch route for ledger search. The browser only calls this origin, so it never receives
// an Elasticsearch URL or credential. The route issues only GET /<fixed index>/_search and forwards a fixed
// allow-list of filters, translated into a bounded query body. Caller-supplied query DSL is never passed
// through. Full search runs in the backend's /api/vulnerabilities/search (see VulnerabilityController).
const ELASTICSEARCH_URL = process.env.ELASTICSEARCH_URL || 'http://elasticsearch:9200';
const VULN_INDEX = 'vulnerabilities';

app.get('/search-direct', async (req, res) => {
    const size = Math.max(1, Math.min(parseInt(req.query.size, 10) || 25, 200));
    const from = Math.max(0, parseInt(req.query.page, 10) || 0) * size;
    const must = [];
    if (req.query.q) {
        must.push({ multi_match: { query: String(req.query.q), fields: ['title', 'description', 'remediation', 'target'] } });
    }
    if (req.query.severity) must.push({ term: { 'severity.keyword': String(req.query.severity).toUpperCase() } });
    if (req.query.status) must.push({ term: { 'status.keyword': String(req.query.status).toUpperCase() } });

    const body = { from, size, query: must.length ? { bool: { must } } : { match_all: {} } };

    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        const upstream = await fetch(`${ELASTICSEARCH_URL}/${VULN_INDEX}/_search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
        }).finally(() => clearTimeout(timer));
        const payload = await upstream.json();
        res.status(upstream.ok ? 200 : 502).json(payload);
    } catch (err) {
        log('search-direct:error', { message: err.message });
        // Elasticsearch unavailability degrades this direct lane only --
        // the browser's primary search path (via /api) is unaffected.
        res.status(503).json({ error: 'elasticsearch unreachable', degraded: true });
    }
});

// Raw markdown for the header's Documentation window. Read fresh on every
// request (the file is small, and a maintainer editing MANUAL.md shouldn't
// need to restart this container to see the change) rather than cached at
// startup.
app.get('/manual', (req, res) => {
    fs.readFile(MANUAL_PATH, 'utf8', (err, content) => {
        if (err) {
            log('manual:error', { message: err.message });
            res.status(404).type('text/plain').send('MANUAL.md is not available on this server.');
            return;
        }
        res.type('text/markdown; charset=utf-8').send(content);
    });
});

app.use(express.static(path.join(__dirname, 'public')));

// Liveness: process is up and serving requests.
app.get('/healthz', (req, res) => res.json({ status: 'ok' }));

// Readiness: process is up AND its declared runtime dependency (the backend)
// is reachable. Kept separate from /healthz so a slow/unreachable backend
// doesn't get this container killed by a liveness probe.
app.get('/readyz', async (_req, res) => {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        const upstream = await fetch(BACKEND_URL, { signal: controller.signal }).finally(() => clearTimeout(timer));
        res.status(upstream.ok ? 200 : 503).json({ status: upstream.ok ? 'ready' : 'degraded', backend: upstream.status });
    } catch (err) {
        res.status(503).json({ status: 'degraded', backend: 'unreachable' });
    }
});

const server = app.listen(PORT, () => {
    log('listening', { port: PORT, backendUrl: BACKEND_URL });
});
// The 'upgrade' event (WebSocket handshake) only ever fires on the
// underlying http.Server, not on the express app -- see the ws:true comment
// on apiProxy above.
server.on('upgrade', apiProxy.upgrade);
