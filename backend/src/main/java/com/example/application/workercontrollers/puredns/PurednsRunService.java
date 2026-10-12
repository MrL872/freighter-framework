package com.example.application.workercontrollers.puredns;

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
 * Starts, stops, and records one puredns run. Validates the command and flags through PurednsFlags, resolves
 * Project Folder inputs through ProjectFileStager, opens a job through SessionService, and stores the expected
 * output through ExpectedOutputRepository. It then sends the run to the worker through PurednsWorkerClient.
 * Results are stored through WorkerResultService. Called by PurednsController and PurednsRelayHandler.
 */
@Service
public class PurednsRunService {
    private static final String OUTPUT_DEFINITION =
        "{\"schema\":\"puredns-findings-v1\",\"wrapper\":[\"worker\",\"date\",\"findings\"]," +
        "\"findingFields\":[\"severity\",\"domain\",\"port\",\"title\",\"description\",\"remediation\",\"worker\",\"date\"]}";
    private static final String REQUIRED_FIELDS = "worker,date,findings";
    private static final long MAX_RESULT_BYTES = 5_242_880;

    private final SessionService sessions;
    private final JobRepository jobs;
    private final com.example.application.persistence.ExpectedOutputRepository expectedOutputs;
    private final WorkerResultService results;
    private final PurednsWorkerClient worker;
    private final ProjectFileStager stager;

    public PurednsRunService(SessionService sessions, JobRepository jobs,
                             com.example.application.persistence.ExpectedOutputRepository expectedOutputs,
                             WorkerResultService results, PurednsWorkerClient worker,
                             ProjectFileStager stager) {
        this.sessions = sessions;
        this.jobs = jobs;
        this.expectedOutputs = expectedOutputs;
        this.results = results;
        this.worker = worker;
        this.stager = stager;
    }

    /**
     * Resolves the file-valued inputs of the payload through ProjectFileStager before PurednsFlags.toArgs() runs:
     *  - the shared flags map's -r/--resolvers, like the file flags of the other tools;
     *  - the command value itself, but only for "resolve" (a single file);
     *  - for "bruteforce", the value is "wordlist.txt domain.com". Only the wordlist half is a Project Folder
     *    file, so the value is split first (via PurednsFlags.splitBruteforceValue, the same split toArgs() uses),
     *    only that half is staged, and the value is then rejoined so toArgs() can split it again unchanged.
     */
    public long start(String profileId, PurednsFlags.Payload flags, boolean interactive) {
        PurednsFlags.Payload resolved = resolvePayload(profileId, flags);
        List<String> args = PurednsFlags.toArgs(resolved);
        if (worker.status() == PurednsWorkerClient.WorkerState.RUNNING) {
            throw new IllegalStateException("puredns worker is already running a job");
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

    private PurednsFlags.Payload resolvePayload(String profileId, PurednsFlags.Payload flags) {
        if (flags == null) {
            return null;
        }
        Map<String, String> resolvedFlags = flags.flags();
        if (resolvedFlags != null) {
            resolvedFlags = new LinkedHashMap<>(resolvedFlags);
            for (Map.Entry<String, String> entry : resolvedFlags.entrySet()) {
                if (PurednsFlags.isFileFlag(entry.getKey())) {
                    entry.setValue(stager.resolve(profileId, entry.getValue()));
                }
            }
        }

        PurednsFlags.Command command = flags.command();
        if (command != null && command.id() != null) {
            if ("resolve".equals(command.id())) {
                command = new PurednsFlags.Command(command.id(), stager.resolve(profileId, command.value()));
            } else if ("bruteforce".equals(command.id())) {
                String[] parts = PurednsFlags.splitBruteforceValue(command.value());
                String stagedWordlist = stager.resolve(profileId, parts[0]);
                command = new PurednsFlags.Command(command.id(), stagedWordlist + " " + parts[1]);
            }
        }

        return new PurednsFlags.Payload(command, resolvedFlags);
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
