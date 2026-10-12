package com.example.application.service;

import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Function;

/**
 * Shared machinery every *RunService uses to turn an isOutput flag (see
 * each tool's own <Tool>-panel.js FLAG_SECTIONS) into a file that actually
 * lands in the selected profile's real Project Folder once a run
 * completes, instead of being lost inside the worker's own ephemeral
 * container filesystem.
 *
 * The flow, shared by all worker run services:
 *   1. Before a run starts, workerPath() rewrites whatever the user typed
 *      for an isOutput flag into a fixed in-container path under
 *      WORKER_OUTPUT_DIR -- the tool itself never sees the user's path, and
 *      every worker's own /output endpoint (see e.g.
 *      xsstrike-worker/server.py's _handle_output, or a Go worker's
 *      handleOutput in main.go) serves files back out of that same fixed
 *      directory. workerPath() also appends a PendingOutput record to the
 *      caller-supplied accumulator list, one per isOutput flag the run
 *      actually used (a single run can set more than one, e.g. nuclei's
 *      -o and -je together).
 *   2. Once the backend's own job id is known, the caller stores that
 *      accumulated list keyed by jobId (each *RunService keeps its own
 *      Map<Long, List<PendingOutput>> for this -- jobId isn't known until
 *      after SessionService.createJobForNewSession() returns, which is why
 *      this class never tracks jobId itself).
 *   3. When the run finishes (successfully or not), the caller's
 *      acceptResult()/markFailed() calls collect(), which -- only on
 *      success -- fetches each pending file over HTTP via the
 *      caller-supplied fetch function (that tool's own WorkerClient's
 *      fetchOutput(name)) and saves it into Project Folder via
 *      ProjectFileService.save().
 *
 * Best-effort throughout: a worker that's gone unreachable, a file the tool
 * never actually wrote (e.g. no findings to log), or a storage error are all
 * silently skipped rather than failing a job that has already been marked
 * succeeded/failed by the time collect() runs. A run that reuses an earlier
 * run's output name (e.g. the same -o value left unchanged between runs)
 * overwrites that earlier file in place instead of being skipped as a
 * collision -- see ProjectFileService.saveOrReplace().
 *
 * Only ever used for single-file output flags (a tool CLI's `-o result.txt`
 * flavor) -- a flag whose value is a directory a tool writes many files
 * into (e.g. nuclei's -store-resp-dir, katana's -store-response-dir,
 * gowitness's --screenshot-path, nmap's -oA basename-expansion, subfinder's
 * -oD) does not fit this one-file-per-flag model and is deliberately left
 * out of every *Flags.java's OUTPUT_FLAGS set -- staging a whole directory
 * tree would need a materially different mechanism (listing + multi-file
 * transfer) this class doesn't attempt.
 */
@Component
public class WorkerOutputStager {
    /**
     * Fixed, worker-container-local directory every isOutput flag's value
     * is rewritten to point at -- never a path on the host. Shared across
     * every worker (Go and Python alike) so there's exactly one convention
     * to remember; see each worker's own /output endpoint.
     */
    public static final String WORKER_OUTPUT_DIR = "/tmp/output/";

    public record PendingOutput(String profileId, String workerFileName, String projectFolderName) {}

    private final ProjectFileService projectFiles;

    public WorkerOutputStager(ProjectFileService projectFiles) {
        this.projectFiles = projectFiles;
    }

    /**
     * Rewrites one isOutput flag's user-supplied value into a fixed
     * in-container path, records a PendingOutput for it in `accumulator`,
     * and returns the path to actually hand the worker as that flag's
     * value.
     */
    public String workerPath(String requestedValue, String profileId, List<PendingOutput> accumulator) {
        String projectFolderName = sanitizeProjectFolderName(requestedValue);
        accumulator.add(new PendingOutput(profileId, projectFolderName, projectFolderName));
        return WORKER_OUTPUT_DIR + projectFolderName;
    }

    public List<PendingOutput> newAccumulator() {
        return new ArrayList<>();
    }

    /**
     * Fetches and stages every pending output file for one finished job.
     * `fetchByName` is that tool's WorkerClient::fetchOutput. It is passed in
     * by the caller because there is no common WorkerClient interface across
     * tools.
     */
    public void collect(List<PendingOutput> pending, Function<String, String> fetchByName, boolean succeeded, String worker) {
        if (pending == null || pending.isEmpty() || !succeeded) {
            return;
        }
        for (PendingOutput p : pending) {
            String content = fetchByName.apply(p.workerFileName());
            if (content == null) {
                continue; // the tool never wrote this file (e.g. nothing to report) -- nothing to stage
            }
            try {
                projectFiles.saveOrReplace(p.profileId(), p.projectFolderName(), content, "text", "output", worker);
            } catch (RuntimeException e) {
                // A storage error here shouldn't retroactively fail a job that
                // already completed -- the live-terminal output and findings
                // are still intact either way.
            }
        }
    }

    private static String sanitizeProjectFolderName(String requested) {
        String name = requested == null ? "" : requested.trim();
        int slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
        if (slash >= 0) {
            name = name.substring(slash + 1);
        }
        if (name.isBlank() || name.equals(".") || name.equals("..")) {
            name = "worker-output";
        }
        return name;
    }
}
