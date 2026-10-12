package com.example.application.controller;

import com.example.application.workercontrollers.dirsearch.DirsearchWorkerClient;
import com.example.application.workercontrollers.ffuf.FfufWorkerClient;
import com.example.application.workercontrollers.fuxploider.FuxploiderWorkerClient;
import com.example.application.workercontrollers.gau.GauWorkerClient;
import com.example.application.workercontrollers.gitleaks.GitleaksWorkerClient;
import com.example.application.workercontrollers.gowitness.GowitnessWorkerClient;
import com.example.application.workercontrollers.hydra.HydraWorkerClient;
import com.example.application.workercontrollers.jwttool.JwttoolWorkerClient;
import com.example.application.workercontrollers.katana.KatanaWorkerClient;
import com.example.application.workercontrollers.masscan.MasscanWorkerClient;
import com.example.application.workercontrollers.metasploit.MetasploitWorkerClient;
import com.example.application.workercontrollers.nmap.NmapWorkerClient;
import com.example.application.workercontrollers.nosqlmap.NosqlmapWorkerClient;
import com.example.application.workercontrollers.nuclei.NucleiWorkerClient;
import com.example.application.workercontrollers.puredns.PurednsWorkerClient;
import com.example.application.workercontrollers.shuffledns.ShuffledNSWorkerClient;
import com.example.application.workercontrollers.sqlmap.SqlmapWorkerClient;
import com.example.application.workercontrollers.sstimap.SstimapWorkerClient;
import com.example.application.workercontrollers.subfinder.SubfinderWorkerClient;
import com.example.application.workercontrollers.wafw00f.Wafw00fWorkerClient;
import com.example.application.workercontrollers.wpscan.WpscanWorkerClient;
import com.example.application.workercontrollers.xsstrike.XsstrikeWorkerClient;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Supplier;

/**
 * Reports the live state of every container in docker-compose.yml besides backend and frontend (the
 * frontend checks its own /healthz directly from the browser instead), for the Services metrics panel
 * (see services.js).
 *
 * Job workers (every *-worker service in WIRED_WORKERS -- see frontend/public/js/wiredWorkers.js) report
 * "running", "idle" or "disconnected". The three non-worker services (mcp-gateway, elasticsearch,
 * telegram-worker) have no job state, just a liveness endpoint, so they report "connected" or
 * "disconnected".
 *
 * Every wired tool reuses its own WorkerClient bean (already configured with that tool's worker.base-url)
 * instead of this controller duplicating that configuration -- see e.g. SubfinderWorkerClient.
 */
@RestController
public class ServicesStatusController {

    public record ServiceStatus(String id, String kind, String state) {}

    private record WorkerProbe(String id, Supplier<String> stateName) {}

    private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(10);

    private final HttpClient http = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(5))
        .build();

    private final List<WorkerProbe> workers;

    @Value("${chat.mcp-gateway-url:http://mcp-gateway:8811}")
    private String mcpGatewayBaseUrl;
    @Value("${elasticsearch.url:http://elasticsearch:9200}")
    private String elasticsearchBaseUrl;
    @Value("${settings.telegram-worker-url:http://telegram-worker:8080}")
    private String telegramWorkerBaseUrl;

    // Order follows WIRED_WORKERS (see frontend/public/js/wiredWorkers.js).
    public ServicesStatusController(SubfinderWorkerClient subfinder, ShuffledNSWorkerClient shuffledns,
                                     GauWorkerClient gau, GitleaksWorkerClient gitleaks, NucleiWorkerClient nuclei,
                                     FfufWorkerClient ffuf, GowitnessWorkerClient gowitness, KatanaWorkerClient katana,
                                     PurednsWorkerClient puredns, NmapWorkerClient nmap, DirsearchWorkerClient dirsearch,
                                     XsstrikeWorkerClient xsstrike, SqlmapWorkerClient sqlmap, HydraWorkerClient hydra,
                                     WpscanWorkerClient wpscan, SstimapWorkerClient sstimap, Wafw00fWorkerClient wafw00f,
                                     JwttoolWorkerClient jwttool, FuxploiderWorkerClient fuxploider,
                                     NosqlmapWorkerClient nosqlmap, MasscanWorkerClient masscan,
                                     MetasploitWorkerClient metasploit) {
        this.workers = List.of(
            new WorkerProbe("subfinder-worker", () -> subfinder.status().name()),
            new WorkerProbe("shuffledns-worker", () -> shuffledns.status().name()),
            new WorkerProbe("gau-worker", () -> gau.status().name()),
            new WorkerProbe("gitleaks-worker", () -> gitleaks.status().name()),
            new WorkerProbe("nuclei-worker", () -> nuclei.status().name()),
            new WorkerProbe("ffuf-worker", () -> ffuf.status().name()),
            new WorkerProbe("gowitness-worker", () -> gowitness.status().name()),
            new WorkerProbe("katana-worker", () -> katana.status().name()),
            new WorkerProbe("puredns-worker", () -> puredns.status().name()),
            new WorkerProbe("nmap-worker", () -> nmap.status().name()),
            new WorkerProbe("dirsearch-worker", () -> dirsearch.status().name()),
            new WorkerProbe("xsstrike-worker", () -> xsstrike.status().name()),
            new WorkerProbe("sqlmap-worker", () -> sqlmap.status().name()),
            new WorkerProbe("hydra-worker", () -> hydra.status().name()),
            new WorkerProbe("wpscan-worker", () -> wpscan.status().name()),
            new WorkerProbe("sstimap-worker", () -> sstimap.status().name()),
            new WorkerProbe("wafw00f-worker", () -> wafw00f.status().name()),
            new WorkerProbe("jwt-tool-worker", () -> jwttool.status().name()),
            new WorkerProbe("fuxploider-worker", () -> fuxploider.status().name()),
            new WorkerProbe("nosqlmap-worker", () -> nosqlmap.status().name()),
            new WorkerProbe("masscan-worker", () -> masscan.status().name()),
            new WorkerProbe("metasploit-worker", () -> metasploit.status().name())
        );
    }

    @GetMapping("/services/status")
    public List<ServiceStatus> status() {
        // One virtual thread per probe: every check is a short blocking HTTP call, and fanning them
        // out concurrently keeps this endpoint's latency bounded by the slowest single probe instead
        // of the sum of all 25 of them.
        try (ExecutorService pool = Executors.newVirtualThreadPerTaskExecutor()) {
            List<CompletableFuture<ServiceStatus>> futures = new ArrayList<>();
            futures.add(CompletableFuture.supplyAsync(
                () -> new ServiceStatus("mcp-gateway", "service", probeReachable(mcpGatewayBaseUrl, "/healthz")), pool));
            futures.add(CompletableFuture.supplyAsync(
                () -> new ServiceStatus("elasticsearch", "service", probeReachable(elasticsearchBaseUrl, "/")), pool));
            futures.add(CompletableFuture.supplyAsync(
                () -> new ServiceStatus("telegram-worker", "service", probeReachable(telegramWorkerBaseUrl, "/health")), pool));
            for (WorkerProbe probe : workers) {
                futures.add(CompletableFuture.supplyAsync(
                    () -> new ServiceStatus(probe.id(), "worker", mapWorkerState(probe.stateName().get())), pool));
            }
            return futures.stream().map(CompletableFuture::join).toList();
        }
    }

    private static String mapWorkerState(String workerStateName) {
        return switch (workerStateName) {
            case "RUNNING" -> "running";
            case "IDLE" -> "idle";
            default -> "disconnected"; // UNREACHABLE
        };
    }

    /** Liveness-only check for the non-worker services (mcp-gateway, elasticsearch, telegram-worker): any HTTP 2xx counts as connected. */
    private String probeReachable(String baseUrl, String path) {
        try {
            HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl + path))
                .timeout(REQUEST_TIMEOUT)
                .GET()
                .build();
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
            return response.statusCode() / 100 == 2 ? "connected" : "disconnected";
        } catch (IOException | IllegalArgumentException e) {
            return "disconnected";
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return "disconnected";
        }
    }
}
