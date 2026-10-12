package com.example.application.workercontrollers.nosqlmap;

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
 * Runs one nosqlmap job: validates the requested flags through NosqlmapFlags, opens a job record, and
 * dispatches it to the nosqlmap worker through NosqlmapWorkerClient. Follows the same
 * validate-then-build-argv-then-dispatch shape as every other *RunService (see e.g. NmapRunService).
 *
 * nosqlmap is in WIRED_WORKERS (frontend/public/js/wiredWorkers.js) and gets its own nosqlmap-panel.js --
 * see that file's own header comment for why the earlier "interactive menu only" assumption about upstream
 * NoSQLMap didn't hold for the installed build, and NosqlmapFlags' class doc for the --attack requirement
 * that keeps a run out of nosqlmap.py's own interactive mainMenu(). Runs always open interactive, the same
 * as every other tool here that can still fall back to asking a question on stdin -- nosqlmap.py does
 * exactly that for any value its non-interactive path still needs but wasn't supplied.
 */
@Service
public class NosqlmapRunService {
    private static final String OUTPUT_DEFINITION =
        "{\"schema\":\"nosqlmap-findings-v1\",\"wrapper\":[\"worker\",\"date\",\"findings\"]," +
        "\"findingFields\":[\"severity\",\"domain\",\"port\",\"title\",\"description\",\"remediation\",\"worker\",\"date\"]}";
    private static final String REQUIRED_FIELDS = "worker,date,findings";
    private static final long MAX_RESULT_BYTES = 5_242_880;

    private final SessionService sessions;
    private final JobRepository jobs;
    private final com.example.application.persistence.ExpectedOutputRepository expectedOutputs;
    private final WorkerResultService results;
    private final NosqlmapWorkerClient worker;
    private final ProjectFileStager stager;

    public NosqlmapRunService(SessionService sessions, JobRepository jobs,
                          com.example.application.persistence.ExpectedOutputRepository expectedOutputs,
                          WorkerResultService results, NosqlmapWorkerClient worker,
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
                if (NosqlmapFlags.isFileFlag(entry.getKey())) {
                    entry.setValue(stager.resolve(profileId, entry.getValue()));
                }
            }
        }
        List<String> args = NosqlmapFlags.toArgs(resolved);
        if (worker.status() == NosqlmapWorkerClient.WorkerState.RUNNING) {
            throw new IllegalStateException("nosqlmap worker is already running a job");
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
}
