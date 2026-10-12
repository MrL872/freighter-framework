package com.example.application.workercontrollers.subfinder;

import com.example.application.persistence.JobResultRecord;
import com.example.application.persistence.JobResultRepository;
import com.example.application.service.FindingTemplateService;
import com.example.application.service.VulnerabilityStatusService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * REST endpoints for the subfinder worker. Accepts POST /subfinder/run with the flags built by
 * subfinder-panel.js and starts the run through SubfinderRunService. Also serves POST /subfinder/input,
 * POST /subfinder/stop, and GET /subfinder/findings, which returns the persisted findings for the ledger.
 * Live terminal output does not pass through this class. SubfinderRelayHandler relays it over WebSocket.
 */
@RestController
public class SubfinderController {
    private final SubfinderRunService runService;
    private final JobResultRepository jobResults;
    private final FindingTemplateService findingTemplates;
    private final VulnerabilityStatusService vulnerabilityStatus;
    private final ObjectMapper mapper = new ObjectMapper();

    public SubfinderController(SubfinderRunService runService, JobResultRepository jobResults,
                               FindingTemplateService findingTemplates,
                               VulnerabilityStatusService vulnerabilityStatus) {
        this.runService = runService;
        this.jobResults = jobResults;
        this.findingTemplates = findingTemplates;
        this.vulnerabilityStatus = vulnerabilityStatus;
    }

    public record RunRequest(String profileId, Map<String, String> flags, Boolean interactive) {}
    public record RunResponse(long jobId) {}
    public record InputRequest(String text) {}

    @PostMapping("/subfinder/run")
    public ResponseEntity<?> run(@RequestBody RunRequest request) {
        if (request.profileId() == null || request.profileId().isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "profileId is required"));
        }
        try {
            long jobId = runService.start(request.profileId(), request.flags(), Boolean.TRUE.equals(request.interactive()));
            return ResponseEntity.accepted().body(new RunResponse(jobId));
        } catch (IllegalStateException e) {
            return ResponseEntity.status(409).body(Map.of("error", e.getMessage()));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/subfinder/input")
    public ResponseEntity<Void> input(@RequestBody InputRequest request) {
        boolean accepted = runService.sendInput(request.text());
        return ResponseEntity.status(accepted ? 202 : 409).build();
    }

    @PostMapping("/subfinder/stop")
    public ResponseEntity<Void> stop() {
        runService.stop();
        return ResponseEntity.accepted().build();
    }

    @PostMapping("/subfinder/pause")
    public ResponseEntity<Void> pause() {
        return ResponseEntity.status(runService.pause() ? 202 : 409).build();
    }

    @PostMapping("/subfinder/resume")
    public ResponseEntity<Void> resume() {
        return ResponseEntity.status(runService.resume() ? 202 : 409).build();
    }

    /**
     * Flattens every persisted {worker,date,findings[]} result for this
     * profile into one findings array. Each finding is a row keyed by the column keys that ledger.js's COLUMNS uses.
     */
    @GetMapping("/subfinder/findings")
    public ResponseEntity<List<Map<String, Object>>> findings(@RequestParam String profileId) {
        List<JobResultRecord> resultRecords = jobResults.findByProfileId(profileId);
        List<Map<String, Object>> findings = new ArrayList<>();
        for (JobResultRecord record : resultRecords) {
            if (!"COMPLETED".equals(record.status())) continue;
            try {
                JsonNode wrapper = mapper.readTree(record.result());
                // job_results isn't scoped by worker (worker_id is never set -- see
                // WorkerResultService.accept callers), so findByProfileId returns every
                // tool's results for this profile. Only take the ones this wrapper's own
                // "worker" field says came from subfinder, or every tool's /findings
                // endpoint would return the same duplicated rows (and the ledger's
                // checkbox selection, keyed by id, would then toggle every duplicate at
                // once since they'd all compute the same id too).
                JsonNode workerNode = wrapper.get("worker");
                if (workerNode == null || !"subfinder".equals(workerNode.asString(null))) continue;
                JsonNode findingsNode = wrapper.get("findings");
                if (findingsNode == null || !findingsNode.isArray()) continue;
                int i = 0;
                for (JsonNode findingNode : (ArrayNode) findingsNode) {
                    Map<String, Object> finding = mapper.convertValue(findingNode, new TypeReference<Map<String, Object>>() {});
                    finding.put("id", record.id() + "_" + (i++));
                    findings.add(finding);
                }
            } catch (Exception e) {
                // A malformed stored result shouldn't take the whole ledger down -- skip it.
            }
        }
        findingTemplates.apply(findings, "subfinder");
        vulnerabilityStatus.apply(findings, "subfinder");
        return ResponseEntity.ok(findings);
    }
}
