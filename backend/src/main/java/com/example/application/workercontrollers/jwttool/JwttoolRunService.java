package com.example.application.workercontrollers.jwttool;

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
 * Orchestrates one jwt-tool run: resolves Project Folder file flags through ProjectFileStager, validates the
 * flags with JwttoolFlags, opens a job, and dispatches it to the jwt-tool-worker over HTTP via
 * JwttoolWorkerClient. Called by JwttoolController.
 *
 * The worker reports back through JwttoolRelayHandler, which calls acceptResult() when a result arrives or
 * markFailed() when the run errors.
 */
@Service
public class JwttoolRunService {
    private static final String OUTPUT_DEFINITION =
        "{\"schema\":\"jwt-tool-findings-v1\",\"wrapper\":[\"worker\",\"date\",\"findings\"]," +
        "\"findingFields\":[\"severity\",\"domain\",\"port\",\"title\",\"description\",\"remediation\",\"worker\",\"date\"]}";
    private static final String REQUIRED_FIELDS = "worker,date,findings";
    private static final long MAX_RESULT_BYTES = 5_242_880;

    private final SessionService sessions;
    private final JobRepository jobs;
    private final com.example.application.persistence.ExpectedOutputRepository expectedOutputs;
    private final WorkerResultService results;
    private final JwttoolWorkerClient worker;
    private final ProjectFileStager stager;

    public JwttoolRunService(SessionService sessions, JobRepository jobs,
                          com.example.application.persistence.ExpectedOutputRepository expectedOutputs,
                          WorkerResultService results, JwttoolWorkerClient worker,
                          ProjectFileStager stager) {
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
                if (JwttoolFlags.isFileFlag(entry.getKey())) {
                    entry.setValue(stager.resolve(profileId, entry.getValue()));
                }
            }
        }
        List<String> args = JwttoolFlags.toArgs(resolved);
        if (worker.status() == JwttoolWorkerClient.WorkerState.RUNNING) {
            throw new IllegalStateException("jwt-tool worker is already running a job");
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
