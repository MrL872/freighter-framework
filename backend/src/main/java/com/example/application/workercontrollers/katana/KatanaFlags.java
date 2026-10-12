package com.example.application.workercontrollers.katana;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Server-side allowlist of katana CLI flags. The flag set follows FLAG_SECTIONS in
 * frontend/public/js/components/worker_components/katana-panel.js. The frontend already restricts what a user
 * can toggle, but that is a UI convenience, not a security boundary: everything arriving at
 * KatanaController#run is untrusted and is re-validated here before it is turned into argv for the worker's
 * katana process.
 *
 * The entire headless group (-headless, -hybrid, -system-chrome and the chrome-only options that depend on
 * them) is excluded. They need a headless Chromium runtime, which the katana-worker image in
 * workers/katana-worker/Dockerfile does not install. Used by KatanaRunService.
 */
public final class KatanaFlags {
    private static final int MAX_VALUE_LENGTH = 2048;

    private static final Map<String, Boolean> ALLOWED = new LinkedHashMap<>();
    static {
        ALLOWED.put("-u", true);
        ALLOWED.put("-resume", true);
        ALLOWED.put("-e", true);
        ALLOWED.put("-r", true);
        ALLOWED.put("-d", true);
        ALLOWED.put("-jc", false);
        ALLOWED.put("-jsl", false);
        ALLOWED.put("-ct", true);
        ALLOWED.put("-kf", true);
        ALLOWED.put("-mrs", true);
        ALLOWED.put("-timeout", true);
        ALLOWED.put("-time-stable", true);
        ALLOWED.put("-aff", false);
        ALLOWED.put("-fx", false);
        ALLOWED.put("-retry", true);
        ALLOWED.put("-proxy", true);
        ALLOWED.put("-td", false);
        ALLOWED.put("-H", true);
        ALLOWED.put("-config", true);
        ALLOWED.put("-fc", true);
        ALLOWED.put("-flc", true);
        ALLOWED.put("-s", true);
        ALLOWED.put("-iqp", false);
        ALLOWED.put("-fsu", false);
        ALLOWED.put("-fst", true);
        ALLOWED.put("-tlsi", false);
        ALLOWED.put("-dr", false);
        ALLOWED.put("-pc", false);
        ALLOWED.put("-kb", false);
        ALLOWED.put("-mdp", true);
        ALLOWED.put("-o", true);
        ALLOWED.put("-output-template", true);
        ALLOWED.put("-sr", false);
        ALLOWED.put("-srd", true);
        ALLOWED.put("-ncb", false);
        ALLOWED.put("-sfd", true);
        ALLOWED.put("-or", false);
        ALLOWED.put("-ob", false);
        ALLOWED.put("-lof", false);
        ALLOWED.put("-eof", false);
        ALLOWED.put("-j", false);
        ALLOWED.put("-nc", false);
        ALLOWED.put("-silent", false);
        ALLOWED.put("-v", false);
        ALLOWED.put("-debug", false);
        ALLOWED.put("-version", false);
        ALLOWED.put("-health-check", false);
        ALLOWED.put("-elog", true);
        ALLOWED.put("-pprof-server", false);
        ALLOWED.put("-cs", true);
        ALLOWED.put("-cos", true);
        ALLOWED.put("-fs", true);
        ALLOWED.put("-ns", false);
        ALLOWED.put("-do", false);
        ALLOWED.put("-mr", true);
        ALLOWED.put("-fr", true);
        ALLOWED.put("-f", true);
        ALLOWED.put("-sf", true);
        ALLOWED.put("-em", true);
        ALLOWED.put("-ef", true);
        ALLOWED.put("-ndef", false);
        ALLOWED.put("-mdc", true);
        ALLOWED.put("-fdc", true);
        ALLOWED.put("-duf", false);
        ALLOWED.put("-fpt", true);
        ALLOWED.put("-c", true);
        ALLOWED.put("-p", true);
        ALLOWED.put("-rd", true);
        ALLOWED.put("-rl", true);
        ALLOWED.put("-rlm", true);
        ALLOWED.put("-hrl", true);
        ALLOWED.put("-hrlm", true);
        ALLOWED.put("-up", false);
        ALLOWED.put("-duc", false);
    }

    // Flags whose value is an isFile pick in katana-panel.js's FLAG_SECTIONS
    // (a Project Folder file name) -- RunService resolves these through
    // ProjectFileStager before toArgs() ever sees them.
    private static final java.util.Set<String> FILE_FLAGS = java.util.Set.of(
        "-resume", "-r", "-config", "-fc", "-flc");

    public static boolean isFileFlag(String flag) {
        return FILE_FLAGS.contains(flag);
    }

    // Flags whose value is an isOutput pick in katana-panel.js's
    // FLAG_SECTIONS -- the file katana itself writes while running is
    // staged back into the selected profile's Project Folder once the run
    // completes. See KatanaRunService.start()/collectOutputs() and
    // WorkerOutputStager. -srd/-sfd (directories of per-host
    // response/field dumps) are deliberately excluded -- see
    // WorkerOutputStager's own class docstring for why a directory output
    // doesn't fit this mechanism.
    private static final java.util.Set<String> OUTPUT_FLAGS = java.util.Set.of("-o", "-elog");

    public static boolean isOutputFlag(String flag) {
        return OUTPUT_FLAGS.contains(flag);
    }

    private KatanaFlags() {}

    /**
     * Turns a {flag: value} map (value is "" for boolean flags) into a
     * validated argv list, in allowlist order so the built command is
     * deterministic. Rejects anything not in ALLOWED, any value that's
     * blank for a value-taking flag, oversized values, or values containing
     * control characters. Requires -u or -list so a run always has a
     * target.
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
                throw new IllegalArgumentException("Unsupported katana flag: " + key);
            }
        }
        if (!flags.containsKey("-u") && !flags.containsKey("-list")) {
            throw new IllegalArgumentException("A run requires -u or -list");
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
