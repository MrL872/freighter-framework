package com.example.application.workercontrollers.xsstrike;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Server-side allowlist of xsstrike CLI flags. The sections follow the FLAG_SECTIONS in
 * frontend/public/js/components/worker_components/xsstrike-panel.js, which were taken from
 * .github/worker_instructions/xsstrike.md (the `xsstrike.py --help` output). The help and update flags are
 * not in the allowlist. The frontend limits what a user can toggle, but that is a UI convenience, not a
 * security boundary. Every flag set arriving at XsstrikeController#run is untrusted and is validated here
 * before it becomes argv for the worker's xsstrike process.
 *
 * xsstrike has no bare positional target. -u/--url is a regular flag and is required.
 */
public final class XsstrikeFlags {
    private static final int MAX_VALUE_LENGTH = 2048;
    private static final String REQUIRED_FLAG = "-u";

    // flag -> takes a value
    private static final Map<String, Boolean> ALLOWED = new LinkedHashMap<>();
    static {
        ALLOWED.put("-u", true);
        ALLOWED.put("--data", true);
        ALLOWED.put("-e", true);
        ALLOWED.put("--fuzzer", false);
        ALLOWED.put("--crawl", false);
        ALLOWED.put("--json", false);
        ALLOWED.put("--path", false);
        ALLOWED.put("--blind", false);
        ALLOWED.put("--seeds", true);
        ALLOWED.put("-f", true);
        ALLOWED.put("-l", true);
        ALLOWED.put("--skip", false);
        ALLOWED.put("--skip-dom", false);
        ALLOWED.put("--headers", true);
        ALLOWED.put("-t", true);
        ALLOWED.put("-d", true);
        ALLOWED.put("--timeout", true);
        ALLOWED.put("--proxy", false);
        ALLOWED.put("--console-log-level", true);
        ALLOWED.put("--file-log-level", true);
        ALLOWED.put("--log-file", true);
    }

    // Flags whose value is a file picked from the Project Folder in xsstrike-panel.js.
    // XsstrikeRunService resolves these through ProjectFileStager before toArgs() sees them.
    private static final java.util.Set<String> FILE_FLAGS = java.util.Set.of("--seeds", "-f");

    public static boolean isFileFlag(String flag) {
        return FILE_FLAGS.contains(flag);
    }

    // Flags whose value is an output file picked in xsstrike-panel.js. The file xsstrike writes during the run
    // is staged into the selected profile's Project Folder after the run completes (see
    // XsstrikeRunService.start() and collectOutputs(), and WorkerOutputStager).
    private static final java.util.Set<String> OUTPUT_FLAGS = java.util.Set.of("--log-file");

    public static boolean isOutputFlag(String flag) {
        return OUTPUT_FLAGS.contains(flag);
    }

    private XsstrikeFlags() {}

    /**
     * Turns a {flag: value} map into a validated argv list. Requires REQUIRED_FLAG (-u) to be present and
     * non-blank, because xsstrike has nothing to scan without a target URL.
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
                throw new IllegalArgumentException("Unsupported xsstrike flag: " + key);
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
