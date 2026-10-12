package com.example.application.workercontrollers.shuffledns;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Server-side allowlist of shuffledns CLI flags. The sections follow the FLAG_SECTIONS in
 * frontend/public/js/components/worker_components/shuffledns-panel.js. The frontend limits what a user can
 * toggle, but that is a UI convenience, not a security boundary. Every flag set arriving at
 * ShuffledNSController#run is untrusted and is validated here before it becomes argv for the worker's
 * shuffledns process.
 */
public final class ShuffledNSFlags {
    private static final int MAX_VALUE_LENGTH = 2048;

    // flag -> takes a value
    private static final Map<String, Boolean> ALLOWED = new LinkedHashMap<>();
    static {
        ALLOWED.put("-d", true);
        ALLOWED.put("-ad", false);
        ALLOWED.put("-l", true);
        ALLOWED.put("-w", true);
        ALLOWED.put("-r", true);
        ALLOWED.put("-tr", true);
        ALLOWED.put("-ri", true);
        ALLOWED.put("-mode", true);
        ALLOWED.put("-o", true);
        ALLOWED.put("-j", false);
        ALLOWED.put("-wo", true);
        ALLOWED.put("-t", true);
        ALLOWED.put("-m", true);
        ALLOWED.put("-mcmd", true);
        ALLOWED.put("-directory", true);
        ALLOWED.put("-retries", true);
        ALLOWED.put("-sw", false);
        ALLOWED.put("-wt", true);
        ALLOWED.put("-retain-stderr", false);
        ALLOWED.put("-batch-size", true);
        ALLOWED.put("-silent", false);
        ALLOWED.put("-version", false);
        ALLOWED.put("-v", false);
        ALLOWED.put("-nc", false);
    }

    // Flags whose value is a file picked from the Project Folder in shuffledns-panel.js.
    // ShuffledNSRunService resolves these through ProjectFileStager before toArgs() sees them.
    private static final java.util.Set<String> FILE_FLAGS = java.util.Set.of("-l", "-w", "-r", "-tr", "-ri", "-m");

    public static boolean isFileFlag(String flag) {
        return FILE_FLAGS.contains(flag);
    }

    // Flags whose value is an output file picked in shuffledns-panel.js. The file shuffledns writes during the
    // run is staged into the selected profile's Project Folder after the run completes (see
    // ShuffledNSRunService.start() and collectOutputs(), and WorkerOutputStager).
    private static final java.util.Set<String> OUTPUT_FLAGS = java.util.Set.of("-o", "-wo");

    public static boolean isOutputFlag(String flag) {
        return OUTPUT_FLAGS.contains(flag);
    }

    private ShuffledNSFlags() {}

    /**
     * Turns a {flag: value} map (value is "" for boolean flags) into a validated argv list, in allowlist
     * order so the built command is deterministic. Rejects anything not in ALLOWED, a blank value for a
     * value-taking flag, oversized values, and values containing control characters. Requires -d or -l so a
     * run always has a target.
     */
    public static List<String> toArgs(Map<String, String> flags) {
        if (flags == null || flags.isEmpty()) {
            throw new IllegalArgumentException("At least one flag is required");
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
                throw new IllegalArgumentException("Unsupported shuffledns flag: " + key);
            }
        }
        if (!flags.containsKey("-d") && !flags.containsKey("-l")) {
            throw new IllegalArgumentException("A run requires -d or -l");
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
