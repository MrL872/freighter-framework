package com.example.application.workercontrollers.nosqlmap;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Server-side allowlist of NoSQLMap CLI flags, mirroring
 * frontend/public/js/components/worker_components/nosqlmap-panel.js's
 * FLAG_SECTIONS. The frontend already restricts what a user can toggle, but
 * that is a UI convenience, not a security boundary -- everything arriving
 * at NosqlmapController#run is untrusted and re-validated here before it is
 * ever turned into argv for the worker's nosqlmap.py process.
 *
 * The installed build (/opt/NoSQLMap/nosqlmap.py in the nosqlmap-worker
 * image) DOES have a real, non-interactive argparse CLI -- confirmed live
 * against "nosqlmap --help" -- when --attack is given: main() branches on
 * `if args.attack:` straight into the non-interactive path using the other
 * args.* values directly, instead of falling into mainMenu(), its fully
 * interactive menu. --attack is therefore required here. nosqlmap.py still
 * falls back to input() prompts for any specific value that path needs but
 * wasn't supplied (e.g. an unset platform or victim) -- that's what
 * NosqlmapController's existing /input route is for, exactly like a sqlmap
 * or hydra prompt.
 */
public final class NosqlmapFlags {
    private static final int MAX_VALUE_LENGTH = 2048;

    // flag -> takes a value
    private static final Map<String, Boolean> ALLOWED = new LinkedHashMap<>();
    static {
        ALLOWED.put("--attack", true);
        ALLOWED.put("--platform", true);
        ALLOWED.put("--victim", true);
        ALLOWED.put("--dbPort", true);
        ALLOWED.put("--myIP", true);
        ALLOWED.put("--myPort", true);
        ALLOWED.put("--webPort", true);
        ALLOWED.put("--uri", true);
        ALLOWED.put("--httpMethod", true);
        ALLOWED.put("--https", true);
        ALLOWED.put("--verb", true);
        ALLOWED.put("--postData", true);
        ALLOWED.put("--requestHeaders", true);
        ALLOWED.put("--injectedParameter", true);
        ALLOWED.put("--injectSize", true);
        ALLOWED.put("--injectFormat", true);
        ALLOWED.put("--params", true);
        ALLOWED.put("--doTimeAttack", true);
        ALLOWED.put("--savePath", true);
    }

    // A run needs --attack: without it, nosqlmap.py drops into mainMenu(),
    // its fully interactive menu, rather than running from flags at all.
    private static final Set<String> REQUIRED_FLAGS = Set.of("--attack");

    // No flag here names a Project Folder file -- --savePath is a bare
    // output filename nosqlmap.py writes itself, not an existing file to
    // read, so it is not FILE_FLAGS the way e.g. NmapFlags' -iL is.
    private static final Set<String> FILE_FLAGS = Set.of();

    public static boolean isFileFlag(String flag) {
        return FILE_FLAGS.contains(flag);
    }

    private NosqlmapFlags() {}

    /**
     * Turns a {flag: value} map into a validated argv list, in allowlist
     * order so the built command is deterministic. Rejects anything not in
     * ALLOWED, any value that's blank for a value-taking flag, oversized
     * values, or values containing control characters -- os/exec on the
     * worker side never invokes a shell, so this isn't an injection vector,
     * but a stray newline/control char has no legitimate reason to be in a
     * CLI arg here. Requires --attack (see REQUIRED_FLAGS above).
     */
    public static List<String> toArgs(Map<String, String> flags) {
        if (flags == null || flags.isEmpty()) {
            throw new IllegalArgumentException("--attack is required");
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
                throw new IllegalArgumentException("Unsupported nosqlmap flag: " + key);
            }
        }
        for (String required : REQUIRED_FLAGS) {
            if (!flags.containsKey(required)) {
                throw new IllegalArgumentException("Flag " + required + " is required");
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
