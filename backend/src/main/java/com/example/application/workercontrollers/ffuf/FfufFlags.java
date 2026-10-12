package com.example.application.workercontrollers.ffuf;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Server-side allowlist of ffuf CLI flags. The flag set follows FLAG_SECTIONS in
 * frontend/public/js/components/worker_components/ffuf-panel.js. The frontend already restricts what a user
 * can toggle, but that is a UI convenience, not a security boundary: everything arriving at FfufController#run
 * is untrusted and is re-validated here before it is turned into argv for the worker's ffuf process. Used by
 * FfufRunService.
 */
public final class FfufFlags {
    private static final int MAX_VALUE_LENGTH = 4096;

    // flag -> takes a value
    private static final Map<String, Boolean> ALLOWED = new LinkedHashMap<>();
    static {
        ALLOWED.put("-u", true);
        ALLOWED.put("-H", true);
        ALLOWED.put("-X", true);
        ALLOWED.put("-b", true);
        ALLOWED.put("-cc", true);
        ALLOWED.put("-ck", true);
        ALLOWED.put("-d", true);
        ALLOWED.put("-http2", false);
        ALLOWED.put("-ignore-body", false);
        ALLOWED.put("-r", false);
        ALLOWED.put("-raw", false);
        ALLOWED.put("-recursion", false);
        ALLOWED.put("-recursion-depth", true);
        ALLOWED.put("-recursion-strategy", true);
        ALLOWED.put("-replay-proxy", true);
        ALLOWED.put("-sni", true);
        ALLOWED.put("-timeout", true);
        ALLOWED.put("-x", true);
        ALLOWED.put("-w", true);
        ALLOWED.put("-D", false);
        ALLOWED.put("-e", true);
        ALLOWED.put("-enc", true);
        ALLOWED.put("-ic", false);
        ALLOWED.put("-input-cmd", true);
        ALLOWED.put("-input-num", true);
        ALLOWED.put("-input-shell", true);
        ALLOWED.put("-mode", true);
        ALLOWED.put("-request", true);
        ALLOWED.put("-request-proto", true);
        ALLOWED.put("-debug-log", true);
        ALLOWED.put("-o", true);
        ALLOWED.put("-od", true);
        ALLOWED.put("-of", true);
        ALLOWED.put("-or", false);
        ALLOWED.put("-V", false);
        ALLOWED.put("-ac", false);
        ALLOWED.put("-acc", true);
        ALLOWED.put("-ach", false);
        ALLOWED.put("-ack", true);
        ALLOWED.put("-acs", true);
        ALLOWED.put("-c", false);
        ALLOWED.put("-config", true);
        ALLOWED.put("-json", false);
        ALLOWED.put("-maxtime", true);
        ALLOWED.put("-maxtime-job", true);
        ALLOWED.put("-noninteractive", false);
        ALLOWED.put("-p", true);
        ALLOWED.put("-rate", true);
        ALLOWED.put("-s", false);
        ALLOWED.put("-sa", false);
        ALLOWED.put("-scraperfile", true);
        ALLOWED.put("-scrapers", true);
        ALLOWED.put("-se", false);
        ALLOWED.put("-search", true);
        ALLOWED.put("-sf", false);
        ALLOWED.put("-t", true);
        ALLOWED.put("-v", false);
        ALLOWED.put("-mc", true);
        ALLOWED.put("-ml", true);
        ALLOWED.put("-mmode", true);
        ALLOWED.put("-mr", true);
        ALLOWED.put("-ms", true);
        ALLOWED.put("-mt", true);
        ALLOWED.put("-mw", true);
        ALLOWED.put("-fc", true);
        ALLOWED.put("-fl", true);
        ALLOWED.put("-fmode", true);
        ALLOWED.put("-fr", true);
        ALLOWED.put("-fs", true);
        ALLOWED.put("-ft", true);
        ALLOWED.put("-fw", true);
    }

    // Flags whose value is an isFile pick in ffuf-panel.js's FLAG_SECTIONS (a
    // Project Folder file name) -- RunService resolves these through
    // ProjectFileStager before toArgs() ever sees them.
    private static final java.util.Set<String> FILE_FLAGS = java.util.Set.of(
        "-cc", "-ck", "-w", "-request", "-config", "-scraperfile");

    public static boolean isFileFlag(String flag) {
        return FILE_FLAGS.contains(flag);
    }

    // Flags whose value is an isOutput pick in ffuf-panel.js's
    // FLAG_SECTIONS -- the file ffuf itself writes while running is staged
    // back into the selected profile's Project Folder once the run
    // completes. See FfufRunService.start()/collectOutputs() and
    // WorkerOutputStager. -od (a directory of per-match results, not a
    // single file) is deliberately excluded -- see WorkerOutputStager's own
    // class docstring for why a directory output doesn't fit this
    // mechanism.
    private static final java.util.Set<String> OUTPUT_FLAGS = java.util.Set.of("-debug-log", "-o");

    public static boolean isOutputFlag(String flag) {
        return OUTPUT_FLAGS.contains(flag);
    }

    private FfufFlags() {}

    /**
     * Turns a {flag: value} map (value is "" for boolean flags) into a
     * validated argv list, in allowlist order so the built command is
     * deterministic. Rejects anything not in ALLOWED, any value that's
     * blank for a value-taking flag, oversized values, or values containing
     * control characters (os/exec on the worker side never invokes a shell,
     * so this isn't an injection vector, but a stray newline/control char
     * has no legitimate reason to be in a CLI arg here). Requires -u (the
     * target URL, with the FUZZ keyword baked into its value by the panel)
     * and -w (the wordlist) so a run always has a target and a wordlist.
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
                throw new IllegalArgumentException("Unsupported ffuf flag: " + key);
            }
        }
        if (!flags.containsKey("-u")) {
            throw new IllegalArgumentException("A run requires -u");
        }
        if (!flags.containsKey("-w")) {
            throw new IllegalArgumentException("A run requires -w");
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
