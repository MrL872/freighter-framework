package com.example.application.workercontrollers.xsstrike;

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
 * REST endpoints for the xsstrike worker. Accepts POST /xsstrike/run, which validates the flags and starts the
 * run through XsstrikeRunService. Also serves POST /xsstrike/input (forwards one line of stdin), POST /xsstrike/stop,
 * and GET /xsstrike/findings (builds the findings list from the completed JobResultRecord rows read through
 * JobResultRepository). The browser reaches these under /api, which frontend/server.js proxies to this backend
 * with the prefix removed.
 */
@RestController
public class XsstrikeController {
    private final XsstrikeRunService runService;
    private final JobResultRepository jobResults;
    private final FindingTemplateService findingTemplates;
    private final VulnerabilityStatusService vulnerabilityStatus;
    private final ObjectMapper mapper = new ObjectMapper();

    public XsstrikeController(XsstrikeRunService runService, JobResultRepository jobResults,
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

    @PostMapping("/xsstrike/run")
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

    @PostMapping("/xsstrike/input")
    public ResponseEntity<Void> input(@RequestBody InputRequest request) {
        boolean accepted = runService.sendInput(request.text());
        return ResponseEntity.status(accepted ? 202 : 409).build();
    }

    @PostMapping("/xsstrike/stop")
    public ResponseEntity<Void> stop() {
        runService.stop();
        return ResponseEntity.accepted().build();
    }

    @PostMapping("/xsstrike/pause")
    public ResponseEntity<Void> pause() {
        return ResponseEntity.status(runService.pause() ? 202 : 409).build();
    }

    @PostMapping("/xsstrike/resume")
    public ResponseEntity<Void> resume() {
        return ResponseEntity.status(runService.resume() ? 202 : 409).build();
    }

    @GetMapping("/xsstrike/findings")
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
                // "worker" field says came from xsstrike, or every tool's /findings
                // endpoint would return the same duplicated rows (and the ledger's
                // checkbox selection, keyed by id, would then toggle every duplicate at
                // once since they'd all compute the same id too).
                JsonNode workerNode = wrapper.get("worker");
                if (workerNode == null || !"xsstrike".equals(workerNode.asString(null))) continue;
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
        findingTemplates.apply(findings, "xsstrike");
        vulnerabilityStatus.apply(findings, "xsstrike");
        return ResponseEntity.ok(findings);
    }
}
