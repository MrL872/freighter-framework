package com.example.application.workercontrollers.fuxploider;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Server-side allowlist of fuxploider CLI flags. The flag set follows FLAG_SECTIONS in
 * frontend/public/js/components/worker_components/fuxploider-panel.js, which was built from
 * .github/worker_instructions/fuxploider.md (the fuxploider --help output; -h/--help is left out). The
 * frontend already restricts what a user can toggle, but that is a UI convenience, not a security boundary:
 * everything arriving at FuxploiderController#run is untrusted and is re-validated here before it is turned
 * into argv for the worker's fuxploider process.
 *
 * fuxploider has no bare positional target; -u/--url is a regular flag. toArgs() requires three flags, -u,
 * --not-regex and --true-regex, so REQUIRED_FLAGS is a set rather than a single constant. Used by
 * FuxploiderRunService.
 */
public final class FuxploiderFlags {
    private static final int MAX_VALUE_LENGTH = 2048;
    private static final java.util.Set<String> REQUIRED_FLAGS = java.util.Set.of("-u", "--not-regex", "--true-regex");

    // flag -> takes a value
    private static final Map<String, Boolean> ALLOWED = new LinkedHashMap<>();
    static {
        // target
        ALLOWED.put("-u", true);
        ALLOWED.put("--not-regex", true);
        ALLOWED.put("--true-regex", true);
        ALLOWED.put("-d", true);
        ALLOWED.put("--cookies", true);
        ALLOWED.put("--uploads-path", true);
        // detection
        ALLOWED.put("-t", true);
        ALLOWED.put("-r", true);
        ALLOWED.put("-l", true);
        ALLOWED.put("-n", true);
        ALLOWED.put("-s", false);
        ALLOWED.put("-y", false);
        // manual form detection
        ALLOWED.put("-m", false);
        ALLOWED.put("--input-name", true);
        ALLOWED.put("--form-action", true);
        // logging
        ALLOWED.put("-v", false);
        ALLOWED.put("-vv", false);
        ALLOWED.put("-vvv", false);
        // network
        ALLOWED.put("-f", true);
        ALLOWED.put("-T", true);
        ALLOWED.put("-U", true);
        ALLOWED.put("--random-user-agent", false);
        ALLOWED.put("--proxy", true);
        ALLOWED.put("--proxy-creds", true);
    }

    // No flag in fuxploider-panel.js's FLAG_SECTIONS takes a Project Folder file.
    // isFileFlag() is kept so FuxploiderRunService can call it without a special case.
    private static final java.util.Set<String> FILE_FLAGS = java.util.Set.of();

    public static boolean isFileFlag(String flag) {
        return FILE_FLAGS.contains(flag);
    }

    private FuxploiderFlags() {}

    /**
     * Turns a {flag: value} map into a validated argv list. Requires every
     * flag in REQUIRED_FLAGS (-u, --not-regex, --true-regex) to be present
     * and non-blank. A run missing any of the three is rejected here, before it
     * reaches the worker.
     */
    public static List<String> toArgs(Map<String, String> flags) {
        if (flags == null || flags.isEmpty()) {
            throw new IllegalArgumentException("Flags -u, --not-regex, and --true-regex are required");
        }
        for (String required : REQUIRED_FLAGS) {
            if (!flags.containsKey(required) || flags.get(required) == null || flags.get(required).isBlank()) {
                throw new IllegalArgumentException("Flag " + required + " is required");
            }
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
                throw new IllegalArgumentException("Unsupported fuxploider flag: " + key);
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
