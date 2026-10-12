package com.example.application.workercontrollers.metasploit;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;

/**
 * Calls the persistent metasploit-worker container over the Docker network (docker-compose.yml's
 * metasploit-worker service) using plain HTTP: GET /status, POST /run, POST /input and POST /stop. Called
 * by MetasploitRunService, and by MetasploitRelayHandler for the worker's WebSocket URL.
 *
 * The base URL comes from metasploit.worker.base-url. The worker is a long-running service, not a container
 * this backend creates or destroys per job.
 */
@Component
public class MetasploitWorkerClient {
    private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(10);

    private final HttpClient http = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(5))
        .build();
    private final ObjectMapper mapper = new ObjectMapper();
    private final String baseUrl;

    public MetasploitWorkerClient(@Value("${metasploit.worker.base-url:http://metasploit-worker:8080}") String baseUrl) {
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
                throw new IllegalStateException("metasploit worker is already running a session");
            }
            if (response.statusCode() / 100 != 2) {
                throw new IllegalStateException("metasploit worker rejected the run request: HTTP " + response.statusCode());
            }
        } catch (IOException | JacksonException e) {
            throw new IllegalStateException("metasploit worker is unreachable: " + e.getMessage(), e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("interrupted while starting the metasploit session", e);
        }
    }

    /** Sends one line to the running session's stdin (POST /input). False when the worker has no session accepting input. */
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

    /** Best-effort: asks the worker to stop its current session. No-ops (worker returns 409) if it's already idle. */
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
}
