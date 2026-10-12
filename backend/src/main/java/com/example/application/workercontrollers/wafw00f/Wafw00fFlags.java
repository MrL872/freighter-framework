package com.example.application.workercontrollers.wafw00f;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Server-side allowlist of wafw00f CLI flags. The sections follow the FLAG_SECTIONS in
 * frontend/public/js/components/worker_components/wafw00f-panel.js. The frontend limits what a user can
 * toggle, but that is a UI convenience, not a security boundary. Every flag set arriving at
 * Wafw00fController#run is untrusted and is validated here before it becomes argv for the worker's
 * wafw00f process. The help, list, and version flags (-h, -l, -V) are not in the allowlist.
 *
 * wafw00f takes its target as a bare positional argument (`wafw00f https://example.com`). The "target"
 * pseudo-flag carries it.
 */
public final class Wafw00fFlags {
    private static final int MAX_VALUE_LENGTH = 2048;
    private static final String BARE_TARGET_KEY = "target";

    // flag -> takes a value
    private static final Map<String, Boolean> ALLOWED = new LinkedHashMap<>();
    static {
        ALLOWED.put("-i", true);
        ALLOWED.put("-a", false);
        ALLOWED.put("-r", false);
        ALLOWED.put("-t", true);
        ALLOWED.put("-o", true);
        ALLOWED.put("-f", true);
        ALLOWED.put("-v", false);
        ALLOWED.put("--no-colors", false);
        ALLOWED.put("-p", true);
        ALLOWED.put("-H", true);
        ALLOWED.put("-T", true);
    }

    // Flags whose value is a file picked from the Project Folder in wafw00f-panel.js.
    // Wafw00fRunService resolves these through ProjectFileStager before toArgs() sees them.
    private static final java.util.Set<String> FILE_FLAGS = java.util.Set.of("-i", "-H");

    public static boolean isFileFlag(String flag) {
        return FILE_FLAGS.contains(flag);
    }

    // Flags whose value is an output file picked in wafw00f-panel.js. The file wafw00f writes during the run
    // is staged into the selected profile's Project Folder after the run completes (see
    // Wafw00fRunService.start() and collectOutputs(), and WorkerOutputStager). Findings come from a regex
    // scan of stdout in workers/wafw00f-worker/server.py, not from this file, so rewriting it does not
    // change findings extraction.
    private static final java.util.Set<String> OUTPUT_FLAGS = java.util.Set.of("-o");

    public static boolean isOutputFlag(String flag) {
        return OUTPUT_FLAGS.contains(flag);
    }

    private Wafw00fFlags() {}

    /**
     * Turns a {flag: value} map into a validated argv list. The "target" key is emitted first with no flag
     * token, matching wafw00f's `wafw00f [options] target` form. Every other allowlisted flag follows in
     * ALLOWED's order. Requires a non-blank target, because wafw00f has nothing to fingerprint without one.
     */
    public static List<String> toArgs(Map<String, String> flags) {
        if (flags == null || flags.isEmpty()) {
            throw new IllegalArgumentException("At least the target is required");
        }
        String target = flags.get(BARE_TARGET_KEY);
        if (target == null || target.isBlank()) {
            throw new IllegalArgumentException("A run requires a target");
        }
        if (target.length() > MAX_VALUE_LENGTH || hasControlCharacters(target)) {
            throw new IllegalArgumentException("target has an invalid value");
        }
        List<String> args = new ArrayList<>();
        args.add(target);

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
            if (!key.equals(BARE_TARGET_KEY) && !ALLOWED.containsKey(key)) {
                throw new IllegalArgumentException("Unsupported wafw00f flag: " + key);
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
