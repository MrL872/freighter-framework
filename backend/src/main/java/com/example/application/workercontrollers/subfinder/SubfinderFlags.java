package com.example.application.workercontrollers.subfinder;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Server-side allowlist of subfinder CLI flags. The sections follow the FLAG_SECTIONS in
 * frontend/public/js/components/worker_components/subfinder-panel.js. The frontend limits what a user
 * can toggle, but that is a UI convenience, not a security boundary. Every flag set arriving at
 * SubfinderController#run is untrusted and is validated here before it becomes argv for the worker's
 * subfinder process.
 * The update flags (-up, -duc) are not in the allowlist. They update the subfinder binary itself and do not run a scan.
 */
public final class SubfinderFlags {
    private static final int MAX_VALUE_LENGTH = 2048;

    // flag -> takes a value
    private static final Map<String, Boolean> ALLOWED = new LinkedHashMap<>();
    static {
        ALLOWED.put("-d", true);
        ALLOWED.put("-dL", true);
        ALLOWED.put("-s", true);
        ALLOWED.put("-recursive", false);
        ALLOWED.put("-all", false);
        ALLOWED.put("-es", true);
        ALLOWED.put("-o", true);
        ALLOWED.put("-oJ", false);
        ALLOWED.put("-oD", true);
        ALLOWED.put("-cs", false);
        ALLOWED.put("-oI", false);
        ALLOWED.put("-m", true);
        ALLOWED.put("-f", true);
        ALLOWED.put("-rl", true);
        ALLOWED.put("-rls", true);
        ALLOWED.put("-t", true);
        ALLOWED.put("-config", true);
        ALLOWED.put("-pc", true);
        ALLOWED.put("-r", true);
        ALLOWED.put("-rL", true);
        ALLOWED.put("-nW", false);
        ALLOWED.put("-proxy", true);
        ALLOWED.put("-ei", false);
        ALLOWED.put("-silent", false);
        ALLOWED.put("-version", false);
        ALLOWED.put("-v", false);
        ALLOWED.put("-nc", false);
        ALLOWED.put("-ls", false);
        ALLOWED.put("-stats", false);
        ALLOWED.put("-timeout", true);
        ALLOWED.put("-max-time", true);
    }

    // Flags whose value is a file picked from the Project Folder in subfinder-panel.js.
    // SubfinderRunService resolves these through ProjectFileStager before toArgs() sees them.
    private static final java.util.Set<String> FILE_FLAGS = java.util.Set.of("-dL", "-config", "-pc", "-rL");

    public static boolean isFileFlag(String flag) {
        return FILE_FLAGS.contains(flag);
    }

    // Flags whose value is an output file picked in subfinder-panel.js. The file subfinder writes during
    // the run is staged into the selected profile's Project Folder after the run completes (see
    // SubfinderRunService.start() and collectOutputs(), and WorkerOutputStager). -oD is left out because
    // it names a directory, and WorkerOutputStager only stages single files.
    private static final java.util.Set<String> OUTPUT_FLAGS = java.util.Set.of("-o");

    public static boolean isOutputFlag(String flag) {
        return OUTPUT_FLAGS.contains(flag);
    }

    private SubfinderFlags() {}

    /**
     * Turns a {flag: value} map (value is "" for boolean flags) into a validated argv list, in allowlist
     * order so the built command is deterministic. Rejects anything not in ALLOWED, a blank value for a
     * value-taking flag, oversized values, and values containing control characters. The worker runs the
     * command without a shell, so control characters are not an injection risk here. They are rejected
     * because a CLI argument has no reason to contain them. Requires -d or -dL so a run always has a target.
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
                throw new IllegalArgumentException("Unsupported subfinder flag: " + key);
            }
        }
        if (!flags.containsKey("-d") && !flags.containsKey("-dL")) {
            throw new IllegalArgumentException("A run requires -d or -dL");
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
