package com.example.application.workercontrollers.metasploit;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Server-side allowlist of msfconsole's own CLI flags, mirroring
 * frontend/public/js/components/worker_components/metasploit-panel.js's
 * FLAG_SECTIONS exactly. The frontend already restricts what a user can
 * toggle, but that is a UI convenience, not a security boundary --
 * everything arriving at MetasploitController#run is untrusted and
 * re-validated here before it is ever turned into argv for the worker's
 * msfconsole process.
 *
 * This is deliberately NOT a flags-driven, run-to-completion tool the way
 * most of the other allowlists in this package are: msfconsole is a
 * long-lived, interactive console. These flags only cover how it is
 * launched (confirmed live against "msfconsole -h") -- the actual work
 * (use, set, run, exploit, search, and every other msfconsole command) is
 * typed into live-terminal.js's input box after launch, reaching the
 * worker through its existing /input route, exactly like a sqlmap or hydra
 * prompt. MetasploitRunService always starts the worker with
 * interactive=true for this reason.
 */
public final class MetasploitFlags {
    private static final int MAX_VALUE_LENGTH = 4096;

    // flag -> takes a value
    private static final Map<String, Boolean> ALLOWED = new LinkedHashMap<>();
    // Flags whose value names a Project Folder/configs/wordlists file (see
    // ProjectFileStager) rather than an arbitrary typed value -- mirrors
    // metasploit-panel.js's isFile.
    private static final Set<String> FILE_FLAGS = new LinkedHashSet<>();
    static {
        // COMMON
        ALLOWED.put("-E", true);

        // DATABASE
        ALLOWED.put("-M", true);
        ALLOWED.put("-n", false);
        ALLOWED.put("-y", true); FILE_FLAGS.add("-y");

        // FRAMEWORK
        ALLOWED.put("-c", true); FILE_FLAGS.add("-c");

        // MODULE
        ALLOWED.put("--defer-module-loads", false);
        ALLOWED.put("--no-defer-module-loads", false);
        ALLOWED.put("-m", true);

        // CONSOLE
        ALLOWED.put("-a", false);
        ALLOWED.put("-H", true);
        ALLOWED.put("-l", true);
        ALLOWED.put("--readline", false);
        ALLOWED.put("--no-readline", false);
        ALLOWED.put("-L", false);
        ALLOWED.put("-o", true);
        ALLOWED.put("-p", true);
        ALLOWED.put("-q", false);
        ALLOWED.put("-r", true); FILE_FLAGS.add("-r");
        ALLOWED.put("-x", true);
    }

    private MetasploitFlags() {}

    public static boolean isFileFlag(String flag) {
        return FILE_FLAGS.contains(flag);
    }

    /**
     * Turns a {flag: value} map (value is "" for boolean flags) into a
     * validated argv list, in allowlist order so the built command is
     * deterministic. Rejects anything not in ALLOWED, any value that's
     * blank for a value-taking flag, oversized values, or values
     * containing control characters -- os/exec on the worker side never
     * invokes a shell, so this isn't an injection vector, but a stray
     * newline/control char has no legitimate reason to be in a CLI arg
     * here. An empty flags map is valid -- launching msfconsole with no
     * flags at all is the normal case.
     */
    public static List<String> toArgs(Map<String, String> flags) {
        List<String> args = new ArrayList<>();
        if (flags == null || flags.isEmpty()) {
            return args;
        }
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
                throw new IllegalArgumentException("Unsupported metasploit flag: " + key);
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
