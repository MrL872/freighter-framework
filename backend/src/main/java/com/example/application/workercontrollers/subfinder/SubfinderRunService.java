package com.example.application.workercontrollers.subfinder;

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
 * Starts, stops, and records one subfinder run. Validates the flags through SubfinderFlags, resolves
 * Project Folder inputs through ProjectFileStager, opens a job through SessionService, and stores the
 * expected output through ExpectedOutputRepository. It then sends the run to the worker through
 * SubfinderWorkerClient. Results are stored through WorkerResultService, using JobResultRecord and
 * WorkerResultValidator. Called by SubfinderController and SubfinderRelayHandler. A "job" here is one
 * run request sent to the long-running subfinder worker.
 */
@Service
public class SubfinderRunService {
    // Schema note for the persisted result. It is checked only by the
    // requiredFields substring check in WorkerResultValidator.
    private static final String OUTPUT_DEFINITION =
        "{\"schema\":\"subfinder-findings-v1\",\"wrapper\":[\"worker\",\"date\",\"findings\"]," +
        "\"findingFields\":[\"severity\",\"domain\",\"port\",\"title\",\"description\",\"remediation\",\"worker\",\"date\"]}";
    // Only the wrapper's always-present keys are required. "findings" may be an
    // empty array when subfinder finds nothing, and a required-field check on the
    // array contents would reject that valid result.
    private static final String REQUIRED_FIELDS = "worker,date,findings";
    private static final long MAX_RESULT_BYTES = 5_242_880; // 5MB of findings JSON

    private final SessionService sessions;
    private final JobRepository jobs;
    private final com.example.application.persistence.ExpectedOutputRepository expectedOutputs;
    private final WorkerResultService results;
    private final SubfinderWorkerClient worker;
    private final ProjectFileStager stager;
    private final WorkerOutputStager outputStager;

    // jobId -> the output flags of this job that are waiting to be staged into
    // the Project Folder once the run finishes (see WorkerOutputStager).
    private final Map<Long, List<WorkerOutputStager.PendingOutput>> pendingOutputs = new ConcurrentHashMap<>();

    public SubfinderRunService(SessionService sessions, JobRepository jobs,
                               com.example.application.persistence.ExpectedOutputRepository expectedOutputs,
                               WorkerResultService results, SubfinderWorkerClient worker,
                               ProjectFileStager stager, WorkerOutputStager outputStager) {
        this.sessions = sessions;
        this.jobs = jobs;
        this.expectedOutputs = expectedOutputs;
        this.results = results;
        this.worker = worker;
        this.stager = stager;
        this.outputStager = outputStager;
    }

    /** Validates flags, opens a job for profileId, and dispatches the run to the worker. Returns the new job id. */
    public long start(String profileId, Map<String, String> flags, boolean interactive) {
        Map<String, String> resolved = flags;
        List<WorkerOutputStager.PendingOutput> pending = outputStager.newAccumulator();
        if (flags != null) {
            resolved = new LinkedHashMap<>(flags);
            for (Map.Entry<String, String> entry : resolved.entrySet()) {
                if (SubfinderFlags.isFileFlag(entry.getKey())) {
                    entry.setValue(stager.resolve(profileId, entry.getValue()));
                } else if (SubfinderFlags.isOutputFlag(entry.getKey())) {
                    entry.setValue(outputStager.workerPath(entry.getValue(), profileId, pending));
                }
            }
        }
        List<String> args = SubfinderFlags.toArgs(resolved);
        if (worker.status() == SubfinderWorkerClient.WorkerState.RUNNING) {
            throw new IllegalStateException("subfinder worker is already running a job");
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

    /** Called by the WS relay once the worker's "result" frame carries the findings wrapper JSON. */
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
        outputStager.collect(pending, worker::fetchOutput, succeeded, "subfinder");
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
