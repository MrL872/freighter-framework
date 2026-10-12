package com.example.application.workercontrollers.gowitness;

import com.example.application.persistence.JobRecord;
import com.example.application.persistence.JobRepository;
import com.example.application.service.ImageStorageService;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import org.springframework.web.util.UriComponentsBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.util.Map;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Relays gowitness-worker's WebSocket stream to the browser tab watching live-terminal.js at /ws/gowitness,
 * for the "line", "result" and "error" frames.
 *
 * "screenshot" frames are handled differently. gowitness's useful output is images, not text for the live
 * terminal, so each "screenshot" frame is intercepted here and never forwarded to the browser. It is saved
 * into the profile's Image Storage through ImageStorageService instead. The browser reads those images back
 * through ImagesController (frontend/public/js/imageFolder.js). Screenshot frames are produced by
 * emitScreenshots in gowitness-worker/main.go.
 *
 * "line" frames (gowitness's stdout and stderr) are forwarded unchanged, as the CLI progress the terminal
 * shows.
 *
 * "result" frames also carry a lightweight findings array (one "info"-severity "Screenshot captured" entry
 * per screenshot, no image data -- see emitScreenshots in gowitness-worker/main.go). That array is wrapped
 * and handed to GowitnessRunService#acceptResult, which stores it the same way every other worker's result
 * is, so GowitnessController#findings can read it back for the ledger.
 */
@Component
public class GowitnessRelayHandler extends TextWebSocketHandler {
    private final GowitnessRunService runService;
    private final JobRepository jobs;
    private final ImageStorageService imageStorage;
    private final ObjectMapper mapper = new ObjectMapper();
    private final String workerWsUrl;
    private final Map<String, WebSocket> outbound = new ConcurrentHashMap<>();
    private final HttpClient httpClient = HttpClient.newHttpClient();

    public GowitnessRelayHandler(GowitnessRunService runService, GowitnessWorkerClient workerClient,
                                 JobRepository jobs, ImageStorageService imageStorage) {
        this.runService = runService;
        this.jobs = jobs;
        this.imageStorage = imageStorage;
        String base = workerClient.baseUrl();
        this.workerWsUrl = (base.startsWith("https:") ? base.replaceFirst("https:", "wss:") : base.replaceFirst("http:", "ws:")) + "/ws";
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        Long jobId = jobId(session);
        if (jobId == null) {
            closeQuietly(session, CloseStatus.BAD_DATA.withReason("jobId query parameter is required"));
            return;
        }
        httpClient.newWebSocketBuilder()
            .buildAsync(URI.create(workerWsUrl), new WorkerListener(session, jobId))
            .whenComplete((ws, error) -> {
                if (error != null) closeQuietly(session, CloseStatus.SERVER_ERROR.withReason("gowitness worker unreachable"));
                else outbound.put(session.getId(), ws);
            });
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        WebSocket ws = outbound.remove(session.getId());
        if (ws != null) ws.abort();
    }

    private Long jobId(WebSocketSession session) {
        String raw = UriComponentsBuilder.fromUri(session.getUri()).build().getQueryParams().getFirst("jobId");
        try {
            return raw == null ? null : Long.valueOf(raw);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private void closeQuietly(WebSocketSession session, CloseStatus status) {
        try { session.close(status); } catch (Exception ignored) { /* already closing */ }
    }

    private void forward(WebSocketSession session, String text) {
        if (!session.isOpen()) return;
        try { session.sendMessage(new TextMessage(text)); } catch (Exception ignored) { /* browser side went away */ }
    }

    /**
     * gowitness-worker's screenshot frame's "url" field is actually just the screenshot's file name
     * (see the LIMITATION note in gowitness-worker/main.go -- gowitness names files by a hash, not the real crawled
     * URL), and its extension is the one reliable signal for the image format: "data" is bare base64
     * (no data: URL wrapper), so this is also where that wrapper gets built before handing the result
     * to ImageStorageService, which expects the same full data: URL shape imageFolder.js stores.
     */
    private static String formatFromName(String name) {
        if (name == null) return "png";
        int dot = name.lastIndexOf('.');
        if (dot < 0 || dot == name.length() - 1) return "png";
        String ext = name.substring(dot + 1).toLowerCase();
        if (ext.equals("jpg")) return "jpeg";
        return (ext.equals("jpeg") || ext.equals("png")) ? ext : "png";
    }

    private final class WorkerListener implements WebSocket.Listener {
        private final WebSocketSession session;
        private final long jobId;
        private final StringBuilder buffer = new StringBuilder();

        WorkerListener(WebSocketSession session, long jobId) {
            this.session = session;
            this.jobId = jobId;
        }

        @Override
        public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
            buffer.append(data);
            webSocket.request(1);
            if (!last) return null;
            String text = buffer.toString();
            buffer.setLength(0);
            handleMessage(webSocket, text);
            return null;
        }

        private void handleMessage(WebSocket webSocket, String text) {
            JsonNode node;
            try {
                node = mapper.readTree(text);
            } catch (Exception e) {
                // Non-JSON/unexpected -- forward verbatim, nothing further to do with it.
                forward(session, text);
                return;
            }
            String type = node.path("type").asString("");

            if ("screenshot".equals(type)) {
                persistScreenshot(node);
                return; // never forwarded to the browser -- see class doc above
            }

            // "line", "result", "error" and anything else: forwarded unchanged.
            forward(session, text);
            try {
                if ("result".equals(type)) {
                    boolean succeeded = node.path("exitCode").asInt(0) == 0;
                    ObjectNode wrapper = mapper.createObjectNode();
                    wrapper.put("worker", node.path("worker").asString("gowitness"));
                    wrapper.put("date", node.path("date").asString(java.time.Instant.now().toString()));
                    JsonNode findingsArray = node.path("findings");
                    wrapper.set("findings", findingsArray.isArray() ? findingsArray : mapper.createArrayNode());
                    runService.acceptResult(jobId, mapper.writeValueAsString(wrapper), succeeded);
                    closeQuietly(session, CloseStatus.NORMAL);
                    webSocket.sendClose(WebSocket.NORMAL_CLOSURE, "done");
                } else if ("error".equals(type)) {
                    runService.markFailed(jobId);
                }
            } catch (Exception e) {
                // Forwarded above regardless; nothing further to persist on a malformed shape.
            }
        }

        private void persistScreenshot(JsonNode node) {
            try {
                JobRecord job = jobs.findById(jobId).orElse(null);
                if (job == null || job.profileId() == null || job.profileId().isBlank()) return;
                String base64 = node.path("data").asString("");
                if (base64.isEmpty()) return;
                String name = node.path("url").asString("screenshot");
                // "target" (bare host) and "endpoint" (the real crawled URL) are resolved worker-side
                // from gowitness's own --write-jsonl report -- blank when gowitness couldn't resolve
                // this screenshot's real URL (see emitScreenshots in gowitness-worker/main.go).
                // ImageFileService groups the saved file under target's own subfolder, or leaves it
                // directly under the profile directory (surfaced as "Unsorted") when target is blank.
                String target = node.path("target").asString(null);
                String endpoint = node.path("endpoint").asString(null);
                String format = formatFromName(name);
                String dataUrl = "data:image/" + format + ";base64," + base64;
                imageStorage.save(job.profileId(), target, endpoint, name, format, dataUrl);
            } catch (Exception e) {
                // Best-effort -- one screenshot failing to persist shouldn't abort the run.
            }
        }

        @Override
        public void onError(WebSocket webSocket, Throwable error) {
            runService.markFailed(jobId);
            closeQuietly(session, CloseStatus.SERVER_ERROR.withReason("gowitness worker connection failed"));
        }

        @Override
        public CompletionStage<?> onClose(WebSocket webSocket, int statusCode, String reason) {
            closeQuietly(session, CloseStatus.NORMAL);
            return null;
        }
    }
}
