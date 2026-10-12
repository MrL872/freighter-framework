package com.example.application.workercontrollers.sstimap;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Server-side allowlist of sstimap CLI flags. The sections follow the FLAG_SECTIONS in
 * frontend/public/js/components/worker_components/sstimap-panel.js, which were taken from
 * .github/worker_instructions/sstimap.md (the `sstimap.py --help` output). The panel's header comment lists
 * what is excluded: info and version flags, interactive-mode-only flags, shell and session flags, and
 * argparse flags that take more than one value. The frontend limits what a user can toggle, but that is a
 * UI convenience, not a security boundary. Every flag set arriving at SstimapController#run is untrusted and
 * is validated here before it becomes argv for the worker's sstimap process.
 *
 * sstimap has no bare positional target. -u/--url is a regular flag and is required.
 */
public final class SstimapFlags {
    private static final int MAX_VALUE_LENGTH = 2048;
    private static final String REQUIRED_FLAG = "-u";

    // flag -> takes a value
    private static final Map<String, Boolean> ALLOWED = new LinkedHashMap<>();
    static {
        // target
        ALLOWED.put("-u", true);
        ALLOWED.put("--load-urls", true);
        ALLOWED.put("--load-forms", true);
        // request
        ALLOWED.put("-M", true);
        ALLOWED.put("-P", true);
        ALLOWED.put("-d", true);
        ALLOWED.put("--data-type", true);
        ALLOWED.put("--data-params", true);
        ALLOWED.put("-H", true);
        ALLOWED.put("-C", true);
        ALLOWED.put("-m", true);
        ALLOWED.put("-a", true);
        ALLOWED.put("-A", false);
        ALLOWED.put("--delay", true);
        ALLOWED.put("-p", true);
        ALLOWED.put("--verify-ssl", false);
        ALLOWED.put("--log-response", false);
        // crawler
        ALLOWED.put("-c", true);
        ALLOWED.put("-f", false);
        ALLOWED.put("--empty-forms", false);
        ALLOWED.put("--crawl-exclude", true);
        ALLOWED.put("--crawl-domains", true);
        ALLOWED.put("--save-urls", true);
        ALLOWED.put("--save-forms", true);
        // detection
        ALLOWED.put("-l", true);
        ALLOWED.put("-e", true);
        ALLOWED.put("-r", true);
        ALLOWED.put("--bool-ok", true);
        ALLOWED.put("--bool-err", true);
        ALLOWED.put("--bool-match", true);
        ALLOWED.put("--bool-match-min", true);
        ALLOWED.put("--blind-delay", true);
        ALLOWED.put("--verify-blind-delay", true);
        ALLOWED.put("--legacy", false);
        ALLOWED.put("--generic", false);
        // payload
        ALLOWED.put("-T", true);
        ALLOWED.put("-X", true);
        ALLOWED.put("-S", true);
        ALLOWED.put("-F", false);
        // general
        ALLOWED.put("--config", true);
        ALLOWED.put("--no-color", false);
    }

    // Flags whose value is a file picked from the Project Folder in sstimap-panel.js.
    // SstimapRunService resolves these through ProjectFileStager before toArgs() sees them.
    private static final java.util.Set<String> FILE_FLAGS = java.util.Set.of(
        "--load-urls", "--load-forms", "--config");

    public static boolean isFileFlag(String flag) {
        return FILE_FLAGS.contains(flag);
    }

    // Flags whose value is an output file picked in sstimap-panel.js. The file sstimap writes during the run
    // is staged into the selected profile's Project Folder after the run completes (see
    // SstimapRunService.start() and collectOutputs(), and WorkerOutputStager). Findings come from a regex
    // scan of stdout in workers/sstimap-worker/server.py, not from these files, so rewriting them does not
    // change findings extraction.
    private static final java.util.Set<String> OUTPUT_FLAGS = java.util.Set.of(
        "--save-urls", "--save-forms");

    public static boolean isOutputFlag(String flag) {
        return OUTPUT_FLAGS.contains(flag);
    }

    private SstimapFlags() {}

    /**
     * Turns a {flag: value} map into a validated argv list. Requires REQUIRED_FLAG (-u) to be present and
     * non-blank, because sstimap has nothing to test without a target URL.
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
                throw new IllegalArgumentException("Unsupported sstimap flag: " + key);
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
