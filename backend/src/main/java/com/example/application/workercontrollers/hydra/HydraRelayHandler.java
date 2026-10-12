package com.example.application.workercontrollers.hydra;

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
 * Relays the hydra-worker's WebSocket stream to the browser tab watching live-terminal.js at /ws/hydra.
 *
 * One outbound WebSocket is opened to the worker for each job, and every text frame is forwarded unchanged. A
 * "result" frame with a findings array goes to HydraRunService#acceptResult as the findings wrapper JSON. A
 * "result" frame without one, an "error" frame, or a failed worker connection calls
 * HydraRunService#markFailed. The jobId query parameter selects the job.
 */
@Component
public class HydraRelayHandler extends TextWebSocketHandler {
    private final HydraRunService runService;
    private final ObjectMapper mapper = new ObjectMapper();
    private final String workerWsUrl;
    private final Map<String, WebSocket> outbound = new ConcurrentHashMap<>();
    private final HttpClient httpClient = HttpClient.newHttpClient();

    public HydraRelayHandler(HydraRunService runService, HydraWorkerClient workerClient) {
        this.runService = runService;
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
                if (error != null) closeQuietly(session, CloseStatus.SERVER_ERROR.withReason("hydra worker unreachable"));
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
            forward(session, text);
            try {
                JsonNode node = mapper.readTree(text);
                String type = node.path("type").asString("");
                if ("result".equals(type)) {
                    boolean succeeded = node.path("exitCode").asInt(0) == 0;
                    JsonNode findingsArray = node.path("findings");
                    if (!findingsArray.isArray()) {
                        runService.markFailed(jobId);
                    } else {
                        ObjectNode wrapper = mapper.createObjectNode();
                        wrapper.put("worker", node.path("worker").asString("hydra"));
                        wrapper.put("date", node.path("date").asString(java.time.Instant.now().toString()));
                        wrapper.set("findings", findingsArray);
                        runService.acceptResult(jobId, mapper.writeValueAsString(wrapper), succeeded);
                    }
                    closeQuietly(session, CloseStatus.NORMAL);
                    webSocket.sendClose(WebSocket.NORMAL_CLOSURE, "done");
                } else if ("error".equals(type)) {
                    runService.markFailed(jobId);
                }
            } catch (Exception e) {
                // Non-JSON or unexpected shape -- still forwarded above as a raw line; nothing further to persist.
            }
        }

        @Override
        public void onError(WebSocket webSocket, Throwable error) {
            runService.markFailed(jobId);
            closeQuietly(session, CloseStatus.SERVER_ERROR.withReason("hydra worker connection failed"));
        }

        @Override
        public CompletionStage<?> onClose(WebSocket webSocket, int statusCode, String reason) {
            closeQuietly(session, CloseStatus.NORMAL);
            return null;
        }
    }
}
