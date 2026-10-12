package com.example.application.workercontrollers.hydra;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;

/**
 * Calls the hydra-worker container over the Docker network (docker-compose.yml's hydra-worker service) using
 * plain HTTP: GET /status, POST /run, POST /input, POST /stop, and GET /output?name=... for the output file of
 * a finished run.
 *
 * The base URL comes from hydra.worker.base-url. The worker is a long-running service, not a container this
 * backend creates or destroys per job.
 *
 * Called by HydraRunService, and by HydraRelayHandler for the worker's WebSocket URL.
 */
@Component
public class HydraWorkerClient {
    private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(10);

    private final HttpClient http = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(5))
        .build();
    private final ObjectMapper mapper = new ObjectMapper();
    private final String baseUrl;

    public HydraWorkerClient(@Value("${hydra.worker.base-url:http://hydra-worker:8080}") String baseUrl) {
        this.baseUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
    }

    public String baseUrl() { return baseUrl; }

    public enum WorkerState { IDLE, RUNNING, UNREACHABLE }

    public WorkerState status() {
        try {
            HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl + "/status"))
                .timeout(REQUEST_TIMEOUT)
                .GET()
                .build();
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() / 100 != 2) return WorkerState.UNREACHABLE;
            Map<?, ?> body = mapper.readValue(response.body(), Map.class);
            return "running".equals(body.get("state")) ? WorkerState.RUNNING : WorkerState.IDLE;
        } catch (IOException | JacksonException e) {
            return WorkerState.UNREACHABLE;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return WorkerState.UNREACHABLE;
        }
    }

    public void run(List<String> args, boolean interactive) {
        try {
            String body = mapper.writeValueAsString(Map.of("args", args, "interactive", interactive));
            HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl + "/run"))
                .timeout(REQUEST_TIMEOUT)
                .header("Content-Type", "application/json; charset=utf-8")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();
            HttpResponse<Void> response = http.send(request, HttpResponse.BodyHandlers.discarding());
            if (response.statusCode() == 409) {
                throw new IllegalStateException("hydra worker is already running a job");
            }
            if (response.statusCode() / 100 != 2) {
                throw new IllegalStateException("hydra worker rejected the run request: HTTP " + response.statusCode());
            }
        } catch (IOException | JacksonException e) {
            throw new IllegalStateException("hydra worker is unreachable: " + e.getMessage(), e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("interrupted while starting the hydra run", e);
        }
    }

    /**
     * Fetches a file this worker's own /output endpoint is serving out of
     * its fixed in-container output directory (see WorkerOutputStager) after
     * a run -- returns null if the worker is unreachable or never wrote that
     * file (404), which the caller treats as "nothing to stage", not a hard
     * failure.
     */
    public String fetchOutput(String name) {
        try {
            String encoded = URLEncoder.encode(name, StandardCharsets.UTF_8);
            HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl + "/output?name=" + encoded))
                .timeout(REQUEST_TIMEOUT)
                .GET()
                .build();
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200) {
                return null;
            }
            return response.body();
        } catch (IOException e) {
            return null;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return null;
        }
    }

    /** Sends one line to the running job's stdin (POST /input). False when the worker has no run accepting input. */
    public boolean sendInput(String text) {
        try {
            String body = mapper.writeValueAsString(Map.of("text", text));
            HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl + "/input"))
                .timeout(REQUEST_TIMEOUT)
                .header("Content-Type", "application/json; charset=utf-8")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();
            HttpResponse<Void> response = http.send(request, HttpResponse.BodyHandlers.discarding());
            return response.statusCode() / 100 == 2;
        } catch (IOException | JacksonException e) {
            return false;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return false;
        }
    }

    /** Best-effort: asks the worker to stop its current run. Network errors are ignored. */
    public void stop() {
        try {
            HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl + "/stop"))
                .timeout(REQUEST_TIMEOUT)
                .POST(HttpRequest.BodyPublishers.noBody())
                .build();
            http.send(request, HttpResponse.BodyHandlers.discarding());
        } catch (IOException ignored) {
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    /** Pauses the running job with Ctrl+Z semantics (POST /pause). False when nothing runs or it is already paused. */
    public boolean pause() {
        return postControl("/pause");
    }

    /** Resumes the paused job with fg semantics (POST /resume). False when nothing is paused. */
    public boolean resume() {
        return postControl("/resume");
    }

    private boolean postControl(String path) {
        try {
            HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl + path))
                .timeout(REQUEST_TIMEOUT)
                .POST(HttpRequest.BodyPublishers.noBody())
                .build();
            HttpResponse<Void> response = http.send(request, HttpResponse.BodyHandlers.discarding());
            return response.statusCode() / 100 == 2;
        } catch (IOException e) {
            return false;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return false;
        }
    }
}
