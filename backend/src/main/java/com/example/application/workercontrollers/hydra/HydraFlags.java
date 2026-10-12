package com.example.application.workercontrollers.hydra;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Server-side allowlist of hydra CLI flags. The flag set follows FLAG_SECTIONS in
 * frontend/public/js/components/worker_components/hydra-panel.js, which was built from
 * .github/worker_instructions/hydra.md (the hydra usage and options text). -h and -U are left out (see
 * hydra-panel.js). The frontend already restricts what a user can toggle, but that is a UI convenience, not a
 * security boundary: everything arriving at HydraController#run is untrusted and is re-validated here before
 * it is turned into argv for the worker's hydra process.
 *
 * hydra takes its target as a bare positional argument (service://host), which is emitted last in argv. Used
 * by HydraRunService.
 */
public final class HydraFlags {
    private static final int MAX_VALUE_LENGTH = 2048;
    private static final String BARE_TARGET_KEY = "target";

    // flag -> takes a value
    private static final Map<String, Boolean> ALLOWED = new LinkedHashMap<>();
    static {
        // target
        ALLOWED.put("-s", true);
        ALLOWED.put("-S", false);
        ALLOWED.put("-m", true);
        // credentials
        ALLOWED.put("-l", true);
        ALLOWED.put("-L", true);
        ALLOWED.put("-p", true);
        ALLOWED.put("-P", true);
        ALLOWED.put("-C", true);
        ALLOWED.put("-x", true);
        ALLOWED.put("-y", false);
        ALLOWED.put("-r", false);
        ALLOWED.put("-e", true);
        ALLOWED.put("-u", false);
        // scope
        ALLOWED.put("-M", true);
        // output
        ALLOWED.put("-o", true);
        ALLOWED.put("-b", true);
        // behavior
        ALLOWED.put("-f", false);
        ALLOWED.put("-F", false);
        ALLOWED.put("-t", true);
        ALLOWED.put("-T", true);
        ALLOWED.put("-w", true);
        ALLOWED.put("-W", true);
        ALLOWED.put("-c", true);
        ALLOWED.put("-K", false);
        ALLOWED.put("-q", false);
        // network
        ALLOWED.put("-4", false);
        ALLOWED.put("-6", false);
        ALLOWED.put("-O", false);
        // logging
        ALLOWED.put("-v", false);
        ALLOWED.put("-V", false);
        ALLOWED.put("-d", false);
        // session
        ALLOWED.put("-R", false);
        ALLOWED.put("-I", false);
    }

    // Flags whose value is an isFile pick in hydra-panel.js's FLAG_SECTIONS
    // (a Project Folder file name) -- RunService resolves these through
    // ProjectFileStager before toArgs() ever sees them.
    private static final java.util.Set<String> FILE_FLAGS = java.util.Set.of("-L", "-P", "-C", "-M");

    public static boolean isFileFlag(String flag) {
        return FILE_FLAGS.contains(flag);
    }

    // Flags whose value is an isOutput pick in hydra-panel.js's
    // FLAG_SECTIONS -- the file hydra itself writes while running is staged
    // back into the selected profile's Project Folder once the run
    // completes. See HydraRunService.start()/collectOutputs() and
    // WorkerOutputStager. hydra-worker/main.go's own findings pipeline
    // regex-matches hydra's "[port][service] host: ... login: ... password:
    // ..." stdout line, not a read of -o's file, so rewriting it doesn't
    // affect findings extraction.
    private static final java.util.Set<String> OUTPUT_FLAGS = java.util.Set.of("-o");

    public static boolean isOutputFlag(String flag) {
        return OUTPUT_FLAGS.contains(flag);
    }

    private HydraFlags() {}

    /**
     * Turns a {flag: value} map into a validated argv list. The bare target
     * ("target" key) is emitted last with no leading flag token (hydra's own
     * CLI convention: `hydra [options] target`), after every other
     * allowlisted flag in ALLOWED's order. Requires the bare target to be
     * present and non-blank -- hydra has nothing to attack without one.
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
        args.add(target);

        for (String key : flags.keySet()) {
            if (!key.equals(BARE_TARGET_KEY) && !ALLOWED.containsKey(key)) {
                throw new IllegalArgumentException("Unsupported hydra flag: " + key);
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
