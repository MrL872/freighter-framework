package com.example.application.workercontrollers.jwttool;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Server-side allowlist of jwt_tool CLI flags. The flag set follows FLAG_SECTIONS in
 * frontend/public/js/components/worker_components/jwt-tool-panel.js, which follows jwt_tool's own --help output
 * (no .github/worker_instructions/jwt-tool.md exists for this tool). -T and -h are not included. The frontend
 * already restricts what a user can toggle, but that is a UI convenience, not a security boundary: everything
 * arriving at JwttoolController#run is untrusted and is re-validated here before it is turned into argv for the
 * worker's jwt_tool.py process.
 *
 * jwt_tool takes the JWT itself as a bare positional argument (`jwt_tool.py <token> [options]`). Used by
 * JwttoolRunService.
 */
public final class JwttoolFlags {
    private static final int MAX_VALUE_LENGTH = 8192; // a JWT itself can be long
    private static final String BARE_TARGET_KEY = "target";

    // flag -> takes a value
    private static final Map<String, Boolean> ALLOWED = new LinkedHashMap<>();
    static {
        // target
        ALLOWED.put("-t", true);
        ALLOWED.put("-r", true);
        ALLOWED.put("-rh", true);
        ALLOWED.put("-rc", true);
        ALLOWED.put("-pd", true);
        ALLOWED.put("-cv", true);
        ALLOWED.put("-rt", true);
        ALLOWED.put("-i", false);
        ALLOWED.put("-np", false);
        ALLOWED.put("-nr", false);
        ALLOWED.put("-b", false);
        ALLOWED.put("-v", false);
        // mode
        ALLOWED.put("-M", true);
        ALLOWED.put("-V", false);
        ALLOWED.put("-I", false);
        ALLOWED.put("-C", false);
        ALLOWED.put("-Q", true);
        // exploits
        ALLOWED.put("-X", true);
        ALLOWED.put("-ju", true);
        ALLOWED.put("-pk", true);
        ALLOWED.put("-pr", true);
        ALLOWED.put("-jw", true);
        // signing
        ALLOWED.put("-S", true);
        ALLOWED.put("-p", true);
        // cracking
        ALLOWED.put("-d", true);
        ALLOWED.put("-kf", true);
        // claim injection
        ALLOWED.put("-hc", true);
        ALLOWED.put("-hv", true);
        ALLOWED.put("-pc", true);
        ALLOWED.put("-pv", true);
    }

    // Flags whose value is an isFile pick in jwt-tool-panel.js's
    // FLAG_SECTIONS (a Project Folder file name) -- RunService resolves
    // these through ProjectFileStager before toArgs() ever sees them.
    private static final java.util.Set<String> FILE_FLAGS = java.util.Set.of("-r", "-pk", "-pr", "-jw", "-d", "-kf");

    public static boolean isFileFlag(String flag) {
        return FILE_FLAGS.contains(flag);
    }

    private JwttoolFlags() {}

    /**
     * Turns a {flag: value} map into a validated argv list. The bare target
     * ("target" key) is emitted first with no leading flag token (jwt_tool's
     * own CLI convention: `jwt_tool.py <token> [options]`), followed by
     * every other allowlisted flag in ALLOWED's order. Requires the bare
     * target to be present and non-blank -- jwt_tool has nothing to
     * analyze without one.
     */
    public static List<String> toArgs(Map<String, String> flags) {
        if (flags == null || flags.isEmpty()) {
            throw new IllegalArgumentException("At least the target JWT is required");
        }
        String target = flags.get(BARE_TARGET_KEY);
        if (target == null || target.isBlank()) {
            throw new IllegalArgumentException("A run requires a target JWT");
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
                throw new IllegalArgumentException("Unsupported jwt_tool flag: " + key);
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
