package com.example.application.workercontrollers.sqlmap;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Server-side allowlist of sqlmap CLI flags. The sections follow the FLAG_SECTIONS in
 * frontend/public/js/components/worker_components/sqlmap-panel.js, which were taken from
 * .github/worker_instructions/sqlmap.md. The list is a curated subset of sqlmap's options, chosen to suit
 * non-interactive runs. The frontend limits what a user can toggle, but that is a UI convenience, not a
 * security boundary. Every flag set arriving at SqlmapController#run is untrusted and is validated here
 * before it becomes argv for the worker's sqlmap process.
 *
 * sqlmap has no bare positional target. -u/--url is a regular flag and is required.
 */
public final class SqlmapFlags {
    private static final int MAX_VALUE_LENGTH = 2048;
    private static final String REQUIRED_FLAG = "-u";

    // flag -> takes a value
    private static final Map<String, Boolean> ALLOWED = new LinkedHashMap<>();
    static {
        // Target
        ALLOWED.put("-u", true);
        ALLOWED.put("-d", true);
        ALLOWED.put("-r", true);
        ALLOWED.put("-l", true);
        ALLOWED.put("-m", true);
        ALLOWED.put("-g", true);
        ALLOWED.put("-c", true);
        // Request
        ALLOWED.put("-A", true);
        ALLOWED.put("-H", true);
        ALLOWED.put("--method", true);
        ALLOWED.put("--data", true);
        ALLOWED.put("--cookie", true);
        ALLOWED.put("--random-agent", false);
        ALLOWED.put("--host", true);
        ALLOWED.put("--referer", true);
        ALLOWED.put("--proxy", true);
        ALLOWED.put("--tor", false);
        ALLOWED.put("--delay", true);
        ALLOWED.put("--timeout", true);
        ALLOWED.put("--retries", true);
        // Detection
        ALLOWED.put("--level", true);
        ALLOWED.put("--risk", true);
        ALLOWED.put("--string", true);
        ALLOWED.put("--not-string", true);
        ALLOWED.put("--text-only", false);
        ALLOWED.put("--batch", false);
        // Optimization
        ALLOWED.put("-o", false);
        ALLOWED.put("--threads", true);
        // Injection
        ALLOWED.put("-p", true);
        ALLOWED.put("--skip", true);
        ALLOWED.put("--dbms", true);
        ALLOWED.put("--os", true);
        ALLOWED.put("--tamper", true);
        ALLOWED.put("--prefix", true);
        ALLOWED.put("--suffix", true);
        // Techniques
        ALLOWED.put("--technique", true);
        ALLOWED.put("--time-sec", true);
        ALLOWED.put("--union-cols", true);
        // Fingerprint
        ALLOWED.put("-f", false);
        // Enumeration
        ALLOWED.put("-a", false);
        ALLOWED.put("-b", false);
        ALLOWED.put("--current-user", false);
        ALLOWED.put("--current-db", false);
        ALLOWED.put("--hostname", false);
        ALLOWED.put("--is-dba", false);
        ALLOWED.put("--users", false);
        ALLOWED.put("--passwords", false);
        ALLOWED.put("--privileges", false);
        ALLOWED.put("--roles", false);
        ALLOWED.put("--dbs", false);
        ALLOWED.put("--tables", false);
        ALLOWED.put("--columns", false);
        ALLOWED.put("--schema", false);
        ALLOWED.put("--dump", false);
        ALLOWED.put("--dump-all", false);
        ALLOWED.put("--search", false);
        ALLOWED.put("-D", true);
        ALLOWED.put("-T", true);
        ALLOWED.put("-C", true);
        ALLOWED.put("-U", true);
        ALLOWED.put("-X", true);
        ALLOWED.put("--exclude-sysdbs", false);
        ALLOWED.put("--count", false);
        // File system access
        ALLOWED.put("--file-read", true);
        ALLOWED.put("--file-write", true);
        ALLOWED.put("--file-dest", true);
        // Operating system access
        ALLOWED.put("--os-cmd", true);
        // General
        ALLOWED.put("-s", true);
        ALLOWED.put("-t", true);
        ALLOWED.put("--crawl", true);
        ALLOWED.put("--dump-file", true);
        ALLOWED.put("--flush-session", false);
        ALLOWED.put("--forms", false);
        ALLOWED.put("--fresh-queries", false);
        ALLOWED.put("--har", true);
        ALLOWED.put("--eta", false);
        // Misc
        ALLOWED.put("--beep", false);
        ALLOWED.put("--disable-coloring", false);
    }

    // Flags whose value is a file picked from the Project Folder in sqlmap-panel.js.
    // SqlmapRunService resolves these through ProjectFileStager before toArgs() sees them.
    private static final java.util.Set<String> FILE_FLAGS = java.util.Set.of(
        "-r", "-l", "-m", "-c", "--file-write", "-s");

    public static boolean isFileFlag(String flag) {
        return FILE_FLAGS.contains(flag);
    }

    // Flags whose value is an output file picked in sqlmap-panel.js. The file sqlmap writes during the run
    // is staged into the selected profile's Project Folder after the run completes (see
    // SqlmapRunService.start() and collectOutputs(), and WorkerOutputStager). Findings come from a regex
    // scan of stdout in workers/sqlmap-worker/server.py, not from these files, so rewriting them does not
    // change findings extraction. --output-dir is left out because it names a whole results directory, and
    // WorkerOutputStager only stages single files.
    private static final java.util.Set<String> OUTPUT_FLAGS = java.util.Set.of(
        "-t", "--dump-file", "--har");

    public static boolean isOutputFlag(String flag) {
        return OUTPUT_FLAGS.contains(flag);
    }

    private SqlmapFlags() {}

    /**
     * Turns a {flag: value} map into a validated argv list. Requires REQUIRED_FLAG (-u) to be present and
     * non-blank, because sqlmap has nothing to test without a target URL.
     */
    public static List<String> toArgs(Map<String, String> flags) {
        if (flags == null || flags.isEmpty() || !flags.containsKey(REQUIRED_FLAG)) {
            throw new IllegalArgumentException("Flag " + REQUIRED_FLAG + " (target URL) is required");
        }
        List<String> args = new ArrayList<>();
        for (Map.Entry<String, Boolean> allowed : ALLOWED.entrySet()) {
            String flag = allowed.getKey();
            if (!flags.containsKey(flag)) continue;
            boolean takesValue = allowed.getValue();
            String value = flags.get(flag);
            if (takesValue) {
                if (value == null || value.isBlank()) {
                    throw new IllegalArgumentException("Flag " + flag + " requires a value");
                }
                if (value.length() > MAX_VALUE_LENGTH || hasControlCharacters(value)) {
                    throw new IllegalArgumentException("Flag " + flag + " has an invalid value");
                }
                args.add(flag);
                args.add(value);
            } else {
                args.add(flag);
            }
        }
        for (String key : flags.keySet()) {
            if (!ALLOWED.containsKey(key)) {
                throw new IllegalArgumentException("Unsupported sqlmap flag: " + key);
            }
        }
        return args;
    }

    private static boolean hasControlCharacters(String value) {
        for (int i = 0; i < value.length(); i++) {
            if (Character.isISOControl(value.charAt(i))) return true;
        }
        return false;
    }
}
