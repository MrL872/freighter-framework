package com.example.application.workercontrollers.wpscan;

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
 * Starts, stops, and records one wpscan run. Resolves Project Folder inputs through ProjectFileStager, stages
 * output files through WorkerOutputStager, sends the validated argv to WpscanWorkerClient, and stores the
 * findings through WorkerResultService. Called by WpscanController and WpscanRelayHandler.
 */
@Service
public class WpscanRunService {
    private static final String OUTPUT_DEFINITION =
        "{\"schema\":\"wpscan-findings-v1\",\"wrapper\":[\"worker\",\"date\",\"findings\"]," +
        "\"findingFields\":[\"severity\",\"domain\",\"port\",\"title\",\"description\",\"remediation\",\"version\",\"worker\",\"date\"]}";
    private static final String REQUIRED_FIELDS = "worker,date,findings";
    private static final long MAX_RESULT_BYTES = 5_242_880;

    private final SessionService sessions;
    private final JobRepository jobs;
    private final com.example.application.persistence.ExpectedOutputRepository expectedOutputs;
    private final WorkerResultService results;
    private final WpscanWorkerClient worker;
    private final ProjectFileStager stager;
    private final WorkerOutputStager outputStager;

    // jobId -> the output flags of this job that are waiting to be staged into
    // the Project Folder once the run finishes (see WorkerOutputStager).
    private final Map<Long, List<WorkerOutputStager.PendingOutput>> pendingOutputs = new ConcurrentHashMap<>();

    public WpscanRunService(SessionService sessions, JobRepository jobs,
                          com.example.application.persistence.ExpectedOutputRepository expectedOutputs,
                          WorkerResultService results, WpscanWorkerClient worker,
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
                if (WpscanFlags.isFileFlag(entry.getKey())) {
                    entry.setValue(stager.resolve(profileId, entry.getValue()));
                } else if (WpscanFlags.isOutputFlag(entry.getKey())) {
                    entry.setValue(outputStager.workerPath(entry.getValue(), profileId, pending));
                }
            }
        }
        List<String> args = WpscanFlags.toArgs(resolved);
        if (worker.status() == WpscanWorkerClient.WorkerState.RUNNING) {
            throw new IllegalStateException("wpscan worker is already running a job");
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
        outputStager.collect(pending, worker::fetchOutput, succeeded, "wpscan");
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
