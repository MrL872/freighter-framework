package com.example.application.workercontrollers.metasploit;

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
 * Launches one msfconsole session: resolves Project Folder/configs/wordlists file flags to staged paths,
 * validates the requested launch flags through MetasploitFlags, opens a job record, and dispatches it to
 * the metasploit worker through MetasploitWorkerClient.
 *
 * Unlike every other *RunService here, start() always launches with interactive=true: msfconsole is a
 * long-lived console, not a run-to-completion process, so stdin always needs to stay open for
 * live-terminal.js's input box to reach it (see MetasploitFlags' class doc). The worker reports back
 * through MetasploitRelayHandler, which calls acceptResult() when a result arrives or markFailed() when the
 * run errors -- in practice a session usually ends via stop() (POST /metasploit/stop, "exit" typed into the
 * console, or the worker container being torn down) rather than a "result" frame, since msfconsole has no
 * built-in notion of a run finishing with findings the way e.g. nmap does.
 */
@Service
public class MetasploitRunService {
    private static final String OUTPUT_DEFINITION =
        "{\"schema\":\"metasploit-findings-v1\",\"wrapper\":[\"worker\",\"date\",\"findings\"]," +
        "\"findingFields\":[\"severity\",\"domain\",\"port\",\"title\",\"description\",\"remediation\",\"worker\",\"date\"]}";
    private static final String REQUIRED_FIELDS = "worker,date,findings";
    private static final long MAX_RESULT_BYTES = 5_242_880; // 5MB of findings JSON

    private final SessionService sessions;
    private final JobRepository jobs;
    private final com.example.application.persistence.ExpectedOutputRepository expectedOutputs;
    private final WorkerResultService results;
    private final MetasploitWorkerClient worker;
    private final ProjectFileStager fileStager;

    public MetasploitRunService(SessionService sessions, JobRepository jobs,
                                 com.example.application.persistence.ExpectedOutputRepository expectedOutputs,
                                 WorkerResultService results, MetasploitWorkerClient worker, ProjectFileStager fileStager) {
        this.sessions = sessions;
        this.jobs = jobs;
        this.expectedOutputs = expectedOutputs;
        this.results = results;
        this.worker = worker;
        this.fileStager = fileStager;
    }

    /** Validates flags, opens a job for profileId, and dispatches the launch to the worker. Returns the new job id. */
    public long start(String profileId, Map<String, String> flags) {
        Map<String, String> resolved = resolveFileFlags(profileId, flags);
        List<String> args = MetasploitFlags.toArgs(resolved);
        if (worker.status() == MetasploitWorkerClient.WorkerState.RUNNING) {
            throw new IllegalStateException("metasploit worker is already running a session");
        }
        JobRecord job = sessions.createJobForNewSession(profileId);
        expectedOutputs.store(job.id(), SupportedOutputType.JSON, OUTPUT_DEFINITION, REQUIRED_FIELDS, "COMPLETED", MAX_RESULT_BYTES);
        try {
            worker.run(args, true);
        } catch (RuntimeException e) {
            jobs.updateStatus(job.id(), JobStatus.FAILED);
            throw e;
        }
        jobs.updateStatus(job.id(), JobStatus.RUNNING);
        return job.id();
    }

    /**
     * isFile-marked flags (-y, -c, -r) arrive from the panel holding a
     * Project Folder/configs/wordlists file NAME, not a real path -- stage
     * each one out via ProjectFileStager before MetasploitFlags ever sees
     * it, so argv only ever contains paths that actually exist from the
     * worker's point of view.
     */
    private Map<String, String> resolveFileFlags(String profileId, Map<String, String> flags) {
        if (flags == null) return flags;
        Map<String, String> resolved = new LinkedHashMap<>(flags);
        for (Map.Entry<String, String> entry : flags.entrySet()) {
            if (MetasploitFlags.isFileFlag(entry.getKey())) {
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

    /** Forwards one line of typed input to the running session. False when no session accepts input. */
    public boolean sendInput(String text) {
        return worker.sendInput(text);
    }

    public void stop() {
        worker.stop();
    }
}
