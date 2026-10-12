package com.example.application.workercontrollers.nmap;

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
 * Runs one nmap job: resolves Project Folder file flags to staged paths, validates the requested flags
 * through NmapFlags, opens a job record, and dispatches it to the nmap worker through NmapWorkerClient.
 */
@Service
public class NmapRunService {
    private static final String OUTPUT_DEFINITION =
        "{\"schema\":\"nmap-findings-v1\",\"wrapper\":[\"worker\",\"date\",\"findings\"]," +
        "\"findingFields\":[\"severity\",\"domain\",\"port\",\"title\",\"description\",\"remediation\",\"version\",\"worker\",\"date\"]}";
    private static final String REQUIRED_FIELDS = "worker,date,findings";
    private static final long MAX_RESULT_BYTES = 5_242_880; // 5MB of findings JSON

    private final SessionService sessions;
    private final JobRepository jobs;
    private final com.example.application.persistence.ExpectedOutputRepository expectedOutputs;
    private final WorkerResultService results;
    private final NmapWorkerClient worker;
    private final ProjectFileStager fileStager;
    private final WorkerOutputStager outputStager;

    // jobId -> this job's isOutput flags pending staging into Project
    // Folder once the run finishes -- see WorkerOutputStager's own class
    // docstring for the full flow.
    private final Map<Long, List<WorkerOutputStager.PendingOutput>> pendingOutputs = new ConcurrentHashMap<>();

    public NmapRunService(SessionService sessions, JobRepository jobs,
                          com.example.application.persistence.ExpectedOutputRepository expectedOutputs,
                          WorkerResultService results, NmapWorkerClient worker, ProjectFileStager fileStager,
                          WorkerOutputStager outputStager) {
        this.sessions = sessions;
        this.jobs = jobs;
        this.expectedOutputs = expectedOutputs;
        this.results = results;
        this.worker = worker;
        this.fileStager = fileStager;
        this.outputStager = outputStager;
    }

    /** Validates flags, opens a job for profileId, and dispatches the run to the worker. Returns the new job id. */
    public long start(String profileId, Map<String, String> flags, boolean interactive) {
        List<WorkerOutputStager.PendingOutput> pending = outputStager.newAccumulator();
        Map<String, String> resolved = resolveFileFlags(profileId, flags);
        resolved = resolveOutputFlags(profileId, resolved, pending);
        List<String> args = NmapFlags.toArgs(resolved);
        if (worker.status() == NmapWorkerClient.WorkerState.RUNNING) {
            throw new IllegalStateException("nmap worker is already running a job");
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
     * isFile-marked flags (-iL, --excludefile, --script-args-file, --resume)
     * arrive from the panel holding a Project Folder file NAME, not a real
     * path -- stage each one out via ProjectFileStager before NmapFlags ever
     * sees it, so argv only ever contains paths that actually exist from the
     * worker's point of view.
     */
    private Map<String, String> resolveFileFlags(String profileId, Map<String, String> flags) {
        if (flags == null) return flags;
        Map<String, String> resolved = new LinkedHashMap<>(flags);
        for (Map.Entry<String, String> entry : flags.entrySet()) {
            if (NmapFlags.isFileFlag(entry.getKey())) {
                resolved.put(entry.getKey(), fileStager.resolve(profileId, entry.getValue()));
            }
        }
        return resolved;
    }

    /**
     * isOutput-marked flags (-oN, -oS, -oG -- see NmapFlags' own OUTPUT_FLAGS
     * comment for why -oX/-oA are excluded) are rewritten to a fixed
     * in-container path and recorded in `pending`, so collectOutputs() can
     * stage the real file into Project Folder once the run finishes -- see
     * WorkerOutputStager.
     */
    private Map<String, String> resolveOutputFlags(String profileId, Map<String, String> flags, List<WorkerOutputStager.PendingOutput> pending) {
        if (flags == null) return flags;
        Map<String, String> resolved = new LinkedHashMap<>(flags);
        for (Map.Entry<String, String> entry : flags.entrySet()) {
            if (NmapFlags.isOutputFlag(entry.getKey())) {
                resolved.put(entry.getKey(), outputStager.workerPath(entry.getValue(), profileId, pending));
            }
        }
        return resolved;
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
        outputStager.collect(pending, worker::fetchOutput, succeeded, "nmap");
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
