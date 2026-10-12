package com.example.application.workercontrollers.gitleaks;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Server-side allowlist of gitleaks CLI flags. The flag set follows FLAG_SECTIONS in
 * frontend/public/js/components/worker_components/gitleaks-panel.js. The frontend already restricts what a
 * user can toggle, but that is a UI convenience, not a security boundary: everything arriving at
 * GitleaksController#run is untrusted and is re-validated here before it is turned into argv for the worker's
 * gitleaks process.
 *
 * gitleaks dispatches on a bare subcommand (dir, git, stdin or version), not a flag. panel.js's COMMAND
 * section marks these `bare: true`. Exactly one is required and, if present, it is emitted first in argv,
 * because gitleaks expects the subcommand before its flags. Used by GitleaksRunService.
 */
public final class GitleaksFlags {
    private static final int MAX_VALUE_LENGTH = 2048;
    private static final Set<String> BARE_COMMANDS = new LinkedHashSet<>(List.of("dir", "git", "stdin", "version"));

    // flag -> takes a value
    private static final Map<String, Boolean> ALLOWED = new LinkedHashMap<>();
    static {
        ALLOWED.put("-c", true);
        ALLOWED.put("-b", true);
        ALLOWED.put("-i", true);
        ALLOWED.put("-f", true);
        ALLOWED.put("-r", true);
        ALLOWED.put("--report-template", true);
        ALLOWED.put("--redact", true);
        ALLOWED.put("--follow-symlinks", false);
        ALLOWED.put("--log-opts", true);
        ALLOWED.put("--platform", true);
        ALLOWED.put("--pre-commit", false);
        ALLOWED.put("--staged", false);
        ALLOWED.put("--enable-rule", true);
        ALLOWED.put("--ignore-gitleaks-allow", false);
        ALLOWED.put("--exit-code", true);
        ALLOWED.put("--max-archive-depth", true);
        ALLOWED.put("--max-decode-depth", true);
        ALLOWED.put("--max-target-megabytes", true);
        ALLOWED.put("--timeout", true);
        ALLOWED.put("--diagnostics", true);
        ALLOWED.put("--diagnostics-dir", true);
        ALLOWED.put("-l", true);
        ALLOWED.put("-v", false);
        ALLOWED.put("--no-banner", false);
        ALLOWED.put("--no-color", false);
        ALLOWED.put("--version", false);
    }

    // Flags whose value is an isFile pick in gitleaks-panel.js's
    // FLAG_SECTIONS (a Project Folder file name) -- RunService resolves these
    // through ProjectFileStager before toArgs() ever sees them. Note -f/-r
    // themselves are NOT file-shaped (-f is a format name, -r/--report-path
    // is an isOutput flag, not isFile) -- only -c/-b/-i/--report-template
    // pick an existing Project Folder file.
    private static final Set<String> FILE_FLAGS = Set.of("-c", "-b", "-i", "--report-template");

    public static boolean isFileFlag(String flag) {
        return FILE_FLAGS.contains(flag);
    }

    // No flag here is eligible for Project-Folder output staging (see
    // WorkerOutputStager): -r/--report-path, the one candidate, is always
    // overridden by gitleaks-worker/main.go's own forced "-f json -r
    // <tmpfile>" appended at the end of argv (see this class's own toArgs()
    // doc comment above) -- whatever path staging rewrote -r to would never
    // actually be what gitleaks writes to. Kept as a real (empty) method so
    // GitleaksRunService can call it without a special case.
    private static final java.util.Set<String> OUTPUT_FLAGS = java.util.Set.of("-r");

    public static boolean isOutputFlag(String flag) {
        return OUTPUT_FLAGS.contains(flag);
    }

    private GitleaksFlags() {}

    /**
     * Turns a {flag: value} map into a validated argv list: exactly one bare
     * subcommand (dir/git/stdin/version) first, then every other allowlisted
     * flag in ALLOWED's order. Rejects anything not in ALLOWED/BARE_COMMANDS,
     * blank values for value-taking flags, oversized values, or control
     * characters. Note: the worker (gitleaks-worker/main.go) always appends
     * its own "-f json -r <tmpfile>" after this argv to guarantee a
     * parseable report -- see the design comment at the top of gitleaks-worker/main.go -- so
     * whatever -f/-r value a caller sets here is effectively overridden
     * downstream; it's still validated here since the argv is otherwise
     * passed straight through.
     */
    public static List<String> toArgs(Map<String, String> flags) {
        if (flags == null || flags.isEmpty()) {
            throw new IllegalArgumentException("A gitleaks command (dir, git, stdin, version) is required");
        }
        List<String> args = new ArrayList<>();

        String command = null;
        for (String bare : BARE_COMMANDS) {
            if (flags.containsKey(bare)) {
                if (command != null) {
                    throw new IllegalArgumentException("Only one gitleaks command may be selected at a time");
                }
                command = bare;
            }
        }
        if (command == null) {
            throw new IllegalArgumentException("A gitleaks command (dir, git, stdin, version) is required");
        }
        args.add(command);

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
            if (!BARE_COMMANDS.contains(key) && !ALLOWED.containsKey(key)) {
                throw new IllegalArgumentException("Unsupported gitleaks flag: " + key);
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
