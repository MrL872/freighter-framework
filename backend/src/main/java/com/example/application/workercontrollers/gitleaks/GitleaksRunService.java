package com.example.application.workercontrollers.gitleaks;

import com.example.application.persistence.JobRecord;
import com.example.application.persistence.JobRepository;
import com.example.application.persistence.JobStatus;
import com.example.application.persistence.SupportedOutputType;
import com.example.application.service.ProjectFileStager;
import com.example.application.service.SessionService;
import com.example.application.service.WorkerOutputStager;
import com.example.application.service.WorkerResultService;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Orchestrates one gitleaks run: validates the flags with GitleaksFlags, opens a job, and dispatches it to the
 * gitleaks-worker over HTTP via GitleaksWorkerClient. Called by GitleaksController. The worker reports back
 * through GitleaksRelayHandler, which calls acceptResult() or markFailed().
 *
 * The findings schema below carries real leak data. Each finding is marked with "high" severity and uses the
 * gitleaks RuleID as its title. See the Finding type in gitleaks-worker/main.go for the translation.
 */
@Service
public class GitleaksRunService {
    private static final String OUTPUT_DEFINITION =
        "{\"schema\":\"gitleaks-findings-v1\",\"wrapper\":[\"worker\",\"date\",\"findings\"]," +
        "\"findingFields\":[\"severity\",\"domain\",\"port\",\"title\",\"description\",\"remediation\",\"worker\",\"date\"]}";
    private static final String REQUIRED_FIELDS = "worker,date,findings";
    private static final long MAX_RESULT_BYTES = 5_242_880;

    private final SessionService sessions;
    private final JobRepository jobs;
    private final com.example.application.persistence.ExpectedOutputRepository expectedOutputs;
    private final WorkerResultService results;
    private final GitleaksWorkerClient worker;
    private final ProjectFileStager stager;
    private final WorkerOutputStager outputStager;

    // jobId -> this job's isOutput flags pending staging into Project
    // Folder once the run finishes -- see WorkerOutputStager's own class
    // docstring for the full flow. In practice always empty for gitleaks --
    // see GitleaksFlags' OUTPUT_FLAGS -- but kept wired, for consistency.
    private final Map<Long, List<WorkerOutputStager.PendingOutput>> pendingOutputs = new ConcurrentHashMap<>();

    public GitleaksRunService(SessionService sessions, JobRepository jobs,
                               com.example.application.persistence.ExpectedOutputRepository expectedOutputs,
                               WorkerResultService results, GitleaksWorkerClient worker,
                               ProjectFileStager stager, WorkerOutputStager outputStager) {
        this.sessions = sessions;
        this.jobs = jobs;
        this.expectedOutputs = expectedOutputs;
        this.results = results;
        this.worker = worker;
        this.stager = stager;
        this.outputStager = outputStager;
    }

    public long start(String profileId, Map<String, String> flags, boolean interactive) {
        Map<String, String> resolved = flags;
        List<WorkerOutputStager.PendingOutput> pending = outputStager.newAccumulator();
        if (flags != null) {
            resolved = new LinkedHashMap<>(flags);
            for (Map.Entry<String, String> entry : resolved.entrySet()) {
                if (GitleaksFlags.isFileFlag(entry.getKey())) {
                    entry.setValue(stager.resolve(profileId, entry.getValue()));
                } else if (GitleaksFlags.isOutputFlag(entry.getKey())) {
                    entry.setValue(outputStager.workerPath(entry.getValue(), profileId, pending));
                }
            }
        }
        List<String> args = GitleaksFlags.toArgs(resolved);
        if (worker.status() == GitleaksWorkerClient.WorkerState.RUNNING) {
            throw new IllegalStateException("gitleaks worker is already running a job");
        }
        JobRecord job = sessions.createJobForNewSession(profileId);
        expectedOutputs.store(job.id(), SupportedOutputType.JSON, OUTPUT_DEFINITION, REQUIRED_FIELDS, "COMPLETED", MAX_RESULT_BYTES);
        if (!pending.isEmpty()) {
            pendingOutputs.put(job.id(), pending);
        }
        try {
            worker.run(args, interactive);
        } catch (RuntimeException e) {
            jobs.updateStatus(job.id(), JobStatus.FAILED);
            pendingOutputs.remove(job.id());
            throw e;
        }
        jobs.updateStatus(job.id(), JobStatus.RUNNING);
        return job.id();
    }

    /**
     * Called by the WS relay once the worker's "result" frame carries the
     * findings wrapper JSON. gitleaks' own
     * process exit code is NOT success/failure for this purpose -- gitleaks
     * exits non-zero when it *found* leaks, which is the interesting case,
     * not an error -- so GitleaksRelayHandler passes succeeded=true whenever
     * a findings array was present at all, regardless of exit code.
     */
    public void acceptResult(long jobId, String findingsWrapperJson, boolean succeeded) {
        results.accept(jobId, null, SupportedOutputType.JSON, "COMPLETED", findingsWrapperJson);
        jobs.updateStatus(jobId, succeeded ? JobStatus.SUCCEEDED : JobStatus.FAILED);
        collectOutputs(jobId, succeeded);
    }

    public void markFailed(long jobId) {
        jobs.updateStatus(jobId, JobStatus.FAILED);
        collectOutputs(jobId, false);
    }

    private void collectOutputs(long jobId, boolean succeeded) {
        List<WorkerOutputStager.PendingOutput> pending = pendingOutputs.remove(jobId);
        outputStager.collect(pending, worker::fetchOutput, succeeded, "gitleaks");
    }

    /** Forwards one line of typed input to the running job. False when no run accepts input. */
    public boolean sendInput(String text) {
        return worker.sendInput(text);
    }

    public void stop() {
        worker.stop();
    }

    /** Pauses the running job (Ctrl+Z on the tool). False when nothing is running or it is already paused. */
    public boolean pause() {
        return worker.pause();
    }

    /** Resumes the paused job (fg on the tool). False when nothing is paused. */
    public boolean resume() {
        return worker.resume();
    }
}
