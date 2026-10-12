package com.example.application.workercontrollers.masscan;

import com.example.application.persistence.JobRecord;
import com.example.application.persistence.JobRepository;
import com.example.application.persistence.JobStatus;
import com.example.application.persistence.SupportedOutputType;
import com.example.application.service.ProjectFileStager;
import com.example.application.service.SessionService;
import com.example.application.service.WorkerResultService;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Runs one masscan job: resolves Project Folder/configs/wordlists file flags to staged paths, validates the
 * requested flags through MasscanFlags, opens a job record, and dispatches it to the masscan worker through
 * MasscanWorkerClient.
 *
 * Unlike NmapRunService, there is no output-staging step: masscan-worker/main.go exposes no /output route
 * (see its own README), so this run service has nothing to fetch an output-flag's written file back from.
 * masscan-panel.js's output flags (-oL, -oJ, -oD, -oG, -oB, -oX, -oU, --output-file) are plain value flags
 * for that reason, same treatment as e.g. FuxploiderFlags' own lack of an isOutput set.
 */
@Service
public class MasscanRunService {
    private static final String OUTPUT_DEFINITION =
        "{\"schema\":\"masscan-findings-v1\",\"wrapper\":[\"worker\",\"date\",\"findings\"]," +
        "\"findingFields\":[\"severity\",\"domain\",\"port\",\"title\",\"description\",\"remediation\",\"worker\",\"date\"]}";
    private static final String REQUIRED_FIELDS = "worker,date,findings";
    private static final long MAX_RESULT_BYTES = 5_242_880; // 5MB of findings JSON

    private final SessionService sessions;
    private final JobRepository jobs;
    private final com.example.application.persistence.ExpectedOutputRepository expectedOutputs;
    private final WorkerResultService results;
    private final MasscanWorkerClient worker;
    private final ProjectFileStager fileStager;

    public MasscanRunService(SessionService sessions, JobRepository jobs,
                              com.example.application.persistence.ExpectedOutputRepository expectedOutputs,
                              WorkerResultService results, MasscanWorkerClient worker, ProjectFileStager fileStager) {
        this.sessions = sessions;
        this.jobs = jobs;
        this.expectedOutputs = expectedOutputs;
        this.results = results;
        this.worker = worker;
        this.fileStager = fileStager;
    }

    /** Validates flags, opens a job for profileId, and dispatches the run to the worker. Returns the new job id. */
    public long start(String profileId, Map<String, String> flags, boolean interactive) {
        Map<String, String> resolved = resolveFileFlags(profileId, flags);
        List<String> args = MasscanFlags.toArgs(resolved);
        if (worker.status() == MasscanWorkerClient.WorkerState.RUNNING) {
            throw new IllegalStateException("masscan worker is already running a job");
        }
        JobRecord job = sessions.createJobForNewSession(profileId);
        expectedOutputs.store(job.id(), SupportedOutputType.JSON, OUTPUT_DEFINITION, REQUIRED_FIELDS, "COMPLETED", MAX_RESULT_BYTES);
        try {
            worker.run(args, interactive);
        } catch (RuntimeException e) {
            jobs.updateStatus(job.id(), JobStatus.FAILED);
            throw e;
        }
        jobs.updateStatus(job.id(), JobStatus.RUNNING);
        return job.id();
    }

    /**
     * isFile-marked flags (-iL, --excludefile, --resume, -c) arrive from the
     * panel holding a Project Folder/configs/wordlists file NAME, not a real
     * path -- stage each one out via ProjectFileStager before MasscanFlags
     * ever sees it, so argv only ever contains paths that actually exist
     * from the worker's point of view.
     */
    private Map<String, String> resolveFileFlags(String profileId, Map<String, String> flags) {
        if (flags == null) return flags;
        Map<String, String> resolved = new LinkedHashMap<>(flags);
        for (Map.Entry<String, String> entry : flags.entrySet()) {
            if (MasscanFlags.isFileFlag(entry.getKey())) {
                resolved.put(entry.getKey(), fileStager.resolve(profileId, entry.getValue()));
            }
        }
        return resolved;
    }

    /** Called by the WS relay once the worker's "result" frame carries the findings wrapper JSON. */
    public void acceptResult(long jobId, String findingsWrapperJson, boolean succeeded) {
        results.accept(jobId, null, SupportedOutputType.JSON, "COMPLETED", findingsWrapperJson);
        jobs.updateStatus(jobId, succeeded ? JobStatus.SUCCEEDED : JobStatus.FAILED);
    }

    public void markFailed(long jobId) {
        jobs.updateStatus(jobId, JobStatus.FAILED);
    }

    /** Forwards one line of typed input to the running job. False when no run accepts input. */
    public boolean sendInput(String text) {
        return worker.sendInput(text);
    }

    public void stop() {
        worker.stop();
    }
}
