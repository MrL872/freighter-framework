package com.example.application.workercontrollers.gau;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Server-side allowlist of gau CLI flags, mirroring
 * frontend/public/js/components/worker_components/gau-panel.js's
 * FLAG_SECTIONS. The frontend already restricts what a user can toggle, but
 * that is a UI convenience, not a security boundary -- everything arriving
 * at GauController#run is untrusted and re-validated here before it is ever
 * turned into argv for the worker's gau process.
 *
 * gau takes its target as a bare positional argument, not a flag --
 * panel.js's own "target" entry (marked `bare: true`) is mirrored here as
 * the pseudo-flag key "target", which toArgs() below places first in argv
 * with no leading dash, same as every other bare CLI positional.
 */
public final class GauFlags {
    private static final int MAX_VALUE_LENGTH = 2048;
    private static final String BARE_TARGET_KEY = "target";

    // flag -> takes a value
    private static final Map<String, Boolean> ALLOWED = new LinkedHashMap<>();
    static {
        ALLOWED.put("--subs", false);
        ALLOWED.put("--providers", true);
        ALLOWED.put("--o", true);
        ALLOWED.put("--json", false);
        ALLOWED.put("--verbose", false);
        ALLOWED.put("--blacklist", true);
        ALLOWED.put("--fc", true);
        ALLOWED.put("--ft", true);
        ALLOWED.put("--fp", false);
        ALLOWED.put("--mc", true);
        ALLOWED.put("--mt", true);
        ALLOWED.put("--from", true);
        ALLOWED.put("--to", true);
        ALLOWED.put("--threads", true);
        ALLOWED.put("--retries", true);
        ALLOWED.put("--timeout", true);
        ALLOWED.put("--config", true);
        ALLOWED.put("--proxy", true);
        ALLOWED.put("--version", false);
    }

    // Flags whose value is an isFile pick in gau-panel.js's FLAG_SECTIONS (a
    // Project Folder file name) -- RunService resolves these through
    // ProjectFileStager before toArgs() ever sees them.
    private static final java.util.Set<String> FILE_FLAGS = java.util.Set.of("--config");

    public static boolean isFileFlag(String flag) {
        return FILE_FLAGS.contains(flag);
    }

    // Flags whose value is an isOutput pick in gau-panel.js's FLAG_SECTIONS
    // -- the file gau itself writes while running is staged back into the
    // selected profile's Project Folder once the run completes. See
    // GauRunService.start()/collectOutputs() and WorkerOutputStager.
    private static final java.util.Set<String> OUTPUT_FLAGS = java.util.Set.of("--o");

    public static boolean isOutputFlag(String flag) {
        return OUTPUT_FLAGS.contains(flag);
    }

    private GauFlags() {}

    /**
     * Turns a {flag: value} map into a validated argv list. The bare target
     * ("target" key, if present) is emitted first with no leading flag
     * token, followed by every other allowlisted flag in ALLOWED's order.
     * Requires the bare target to be present and non-blank -- gau has
     * nothing to enumerate without one.
     */
    public static List<String> toArgs(Map<String, String> flags) {
        if (flags == null || flags.isEmpty()) {
            throw new IllegalArgumentException("At least the target is required");
        }
        List<String> args = new ArrayList<>();
        String target = flags.get(BARE_TARGET_KEY);
        if (target == null || target.isBlank()) {
            throw new IllegalArgumentException("A run requires a target");
        }
        if (target.length() > MAX_VALUE_LENGTH || hasControlCharacters(target)) {
            throw new IllegalArgumentException("target has an invalid value");
        }
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
                throw new IllegalArgumentException("Unsupported gau flag: " + key);
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
