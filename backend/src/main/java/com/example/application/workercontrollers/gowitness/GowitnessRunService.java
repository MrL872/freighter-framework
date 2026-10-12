package com.example.application.workercontrollers.gowitness;

import com.example.application.persistence.ExpectedOutputRepository;
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
 * Orchestrates one gowitness run: validates the requested flags with GowitnessFlags, opens a job, and
 * dispatches it to gowitness-worker over HTTP via GowitnessWorkerClient. Called by GowitnessController.
 *
 * gowitness's primary output is screenshot images, which GowitnessRelayHandler writes straight into Image
 * Storage through ImageStorageService as each "screenshot" frame arrives. Alongside that, the worker also
 * emits one lightweight "info"-severity finding per screenshot ("Screenshot captured", no image data) --
 * this service stores that findings wrapper through WorkerResultService, the same path every other worker
 * uses, purely so the ledger shows *that* a screenshot was taken (see GowitnessController#findings). This
 * service also handles the job lifecycle (RUNNING, then SUCCEEDED or FAILED) and resolves the isFile flags
 * (--file and --javascript-file) through ProjectFileStager before building argv.
 */
@Service
public class GowitnessRunService {
    private static final String OUTPUT_DEFINITION =
        "{\"schema\":\"gowitness-findings-v1\",\"wrapper\":[\"worker\",\"date\",\"findings\"]," +
        "\"findingFields\":[\"severity\",\"path\",\"title\",\"description\",\"version\",\"worker\",\"date\"]}";
    private static final String REQUIRED_FIELDS = "worker,date,findings";
    private static final long MAX_RESULT_BYTES = 1_048_576;

    private final SessionService sessions;
    private final JobRepository jobs;
    private final ExpectedOutputRepository expectedOutputs;
    private final WorkerResultService results;
    private final GowitnessWorkerClient worker;
    private final ProjectFileStager stager;

    public GowitnessRunService(SessionService sessions, JobRepository jobs, ExpectedOutputRepository expectedOutputs,
                               WorkerResultService results, GowitnessWorkerClient worker, ProjectFileStager stager) {
        this.sessions = sessions;
        this.jobs = jobs;
        this.expectedOutputs = expectedOutputs;
        this.results = results;
        this.worker = worker;
        this.stager = stager;
    }

    public long start(String profileId, Map<String, String> flags, boolean interactive) {
        Map<String, String> resolved = flags;
        if (flags != null) {
            resolved = new LinkedHashMap<>(flags);
            for (Map.Entry<String, String> entry : resolved.entrySet()) {
                if (GowitnessFlags.isFileFlag(entry.getKey())) {
                    entry.setValue(stager.resolve(profileId, entry.getValue()));
                }
            }
        }
        List<String> args = GowitnessFlags.toArgs(resolved);
        if (worker.status() == GowitnessWorkerClient.WorkerState.RUNNING) {
            throw new IllegalStateException("gowitness worker is already running a job");
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
     * Completes the job's lifecycle once the worker's "result" frame arrives. The screenshot images
     * themselves were already persisted into Image Storage as they streamed in, one "screenshot" frame
     * at a time, by GowitnessRelayHandler -- findingsWrapperJson carries only the lightweight metadata
     * findings (no image data) that arrived alongside them, stored here the same way every other
     * worker's result is, so GowitnessController#findings can read them back for the ledger.
     */
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

    /** Pauses the running job (Ctrl+Z on the tool). False when nothing is running or it is already paused. */
    public boolean pause() {
        return worker.pause();
    }

    /** Resumes the paused job (fg on the tool). False when nothing is paused. */
    public boolean resume() {
        return worker.resume();
    }
}
