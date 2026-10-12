package com.example.application.workercontrollers.subfinder;

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
 * Calls the subfinder worker container over HTTP: POST /run, POST /input, POST /stop, GET /status, and
 * GET /output. The base URL defaults to http://subfinder-worker:8080 (docker-compose.yml's subfinder-worker
 * service). The worker is a long-running service that is already up. This backend does not create or
 * remove it per job. Uses the JDK's built-in HttpClient, which SubfinderRelayHandler also uses for its
 * outbound WebSocket. Called by SubfinderRunService.
 */
@Component
public class SubfinderWorkerClient {
    private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(10);

    private final HttpClient http = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(5))
        .build();
    private final ObjectMapper mapper = new ObjectMapper();
    private final String baseUrl;

    public SubfinderWorkerClient(@Value("${subfinder.worker.base-url:http://subfinder-worker:8080}") String baseUrl) {
        this.baseUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
    }

    /** The base URL this client was configured with (e.g. http://subfinder-worker:8080). The relay uses it to build the ws:// URL. */
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
            // JacksonException (Jackson 3.x) is unchecked, unlike the checked
            // IOException subtypes, so it is caught explicitly here. A malformed
            // /status body is then treated as unreachable rather than propagating
            // out of this method.
            return WorkerState.UNREACHABLE;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return WorkerState.UNREACHABLE;
        }
    }

    /** Starts a run on the worker. Throws IllegalStateException if the worker is busy or unreachable. */
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
                throw new IllegalStateException("subfinder worker is already running a job");
            }
            if (response.statusCode() / 100 != 2) {
                throw new IllegalStateException("subfinder worker rejected the run request: HTTP " + response.statusCode());
            }
        } catch (IOException | JacksonException e) {
            // See the matching comment in status(). writeValueAsString throws an
            // unchecked JacksonException, not a checked IOException subtype, so it
            // needs its own catch clause here too.
            throw new IllegalStateException("subfinder worker is unreachable: " + e.getMessage(), e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("interrupted while starting the subfinder run", e);
        }
    }

    /**
     * Fetches one output file from the worker's GET /output endpoint after a run. The file is read from the
     * worker's fixed output directory (see WorkerOutputStager). Returns null when the worker is unreachable
     * or does not return HTTP 200, for example when the file was never written. The caller treats null as
     * "nothing to stage", not as a failure.
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

    /** Best-effort: asks the worker to stop its current run (POST /stop). Failures are ignored. */
    public void stop() {
        try {
            HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl + "/stop"))
                .timeout(REQUEST_TIMEOUT)
                .POST(HttpRequest.BodyPublishers.noBody())
                .build();
            // Nothing to act on here either way -- the WS relay observes the
            // resulting "result"/"error" frame and updates the job accordingly.
            http.send(request, HttpResponse.BodyHandlers.discarding());
        } catch (IOException ignored) {
            // The stop request is not retried. The caller gets no confirmation either way.
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
