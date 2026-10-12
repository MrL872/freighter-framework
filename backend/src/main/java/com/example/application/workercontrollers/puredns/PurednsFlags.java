package com.example.application.workercontrollers.puredns;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Server-side allowlist of puredns CLI flags. The COMMANDS and FLAG_SECTIONS come from
 * frontend/public/js/components/worker_components/puredns-panel.js. puredns runs a subcommand (resolve or
 * bruteforce) that takes its own positional argument. The panel therefore sends {command: {id, value},
 * flags: {...}}, not a flat flag map. This is why the input type is Payload and toArgs() takes a Payload.
 * Every payload arriving at PurednsController#run is untrusted and is validated here before it becomes argv
 * for the worker's puredns process.
 */
public final class PurednsFlags {
    private static final int MAX_VALUE_LENGTH = 4096;

    private static final Set<String> COMMANDS = Set.of("resolve", "bruteforce");

    // flag -> takes a value
    private static final Map<String, Boolean> ALLOWED = new LinkedHashMap<>();
    static {
        ALLOWED.put("-r", true);
        ALLOWED.put("--resolvers-trusted", true);
        ALLOWED.put("-l", true);
        ALLOWED.put("--rate-limit-trusted", true);
        ALLOWED.put("-t", true);
        ALLOWED.put("--skip-wildcard-filter", false);
        ALLOWED.put("--wildcard-batch", true);
        ALLOWED.put("-n", true);
        ALLOWED.put("-q", false);
        ALLOWED.put("--debug", false);
        ALLOWED.put("--skip-sanitize", false);
        ALLOWED.put("--skip-validation", false);
        ALLOWED.put("--trusted-only", false);
    }

    // Flags in the shared `flags` map (not the command) whose value is a file picked from the Project Folder
    // in puredns-panel.js. PurednsRunService resolves these through ProjectFileStager before toArgs() sees
    // them. The command's own file handling is separate. See splitBruteforceValue() and PurednsRunService.
    private static final Set<String> FILE_FLAGS = Set.of("-r", "--resolvers-trusted");

    public static boolean isFileFlag(String flag) {
        return FILE_FLAGS.contains(flag);
    }

    private PurednsFlags() {}

    public record Command(String id, String value) {}
    public record Payload(Command command, Map<String, String> flags) {}

    /**
     * Splits bruteforce's single typed value ("wordlist.txt domain.com") into its two positional arguments at
     * the first run of whitespace. toArgs() uses both halves as they are. PurednsRunService stages only the
     * wordlist half through ProjectFileStager, because a bare domain is not a Project Folder file and would
     * fail resolve().
     */
    public static String[] splitBruteforceValue(String value) {
        if (value == null) {
            throw new IllegalArgumentException("bruteforce requires a wordlist and a domain, e.g. \"wordlist.txt domain.com\"");
        }
        String[] parts = value.trim().split("\\s+", 2);
        if (parts.length != 2) {
            throw new IllegalArgumentException("bruteforce requires a wordlist and a domain, e.g. \"wordlist.txt domain.com\"");
        }
        return parts;
    }

    /**
     * Turns a {command, flags} payload into a validated argv list. The command id (resolve or bruteforce) comes
     * first, then its positional value(s), then any allowlisted flags in a fixed order. bruteforce's value is one
     * field in the panel ("wordlist.txt domain.com", per its placeholder) that holds two positional arguments,
     * split at the first run of whitespace. resolve's value is a single file path. Rejects an unrecognized
     * command, a missing, blank, oversized, or control-character value, and any flag not in ALLOWED.
     */
    public static List<String> toArgs(Payload payload) {
        if (payload == null || payload.command() == null || payload.command().id() == null || payload.command().id().isBlank()) {
            throw new IllegalArgumentException("A run requires a command (resolve or bruteforce)");
        }
        Command command = payload.command();
        if (!COMMANDS.contains(command.id())) {
            throw new IllegalArgumentException("Unsupported puredns command: " + command.id());
        }
        String value = command.value();
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Command " + command.id() + " requires a value");
        }
        if (value.length() > MAX_VALUE_LENGTH || hasControlCharacters(value)) {
            throw new IllegalArgumentException("Command value is invalid");
        }

        List<String> args = new ArrayList<>();
        args.add(command.id());
        if ("bruteforce".equals(command.id())) {
            String[] parts = splitBruteforceValue(value);
            args.add(parts[0]);
            args.add(parts[1]);
        } else {
            args.add(value);
        }

        Map<String, String> flags = payload.flags() != null ? payload.flags() : Map.of();
        for (Map.Entry<String, Boolean> allowed : ALLOWED.entrySet()) {
            String flag = allowed.getKey();
            if (!flags.containsKey(flag)) continue;
            boolean takesValue = allowed.getValue();
            String flagValue = flags.get(flag);
            if (takesValue) {
                if (flagValue == null || flagValue.isBlank()) {
                    throw new IllegalArgumentException("Flag " + flag + " requires a value");
                }
                if (flagValue.length() > MAX_VALUE_LENGTH || hasControlCharacters(flagValue)) {
                    throw new IllegalArgumentException("Flag " + flag + " has an invalid value");
                }
                args.add(flag);
                args.add(flagValue);
            } else {
                args.add(flag);
            }
        }
        for (String key : flags.keySet()) {
            if (!ALLOWED.containsKey(key)) {
                throw new IllegalArgumentException("Unsupported puredns flag: " + key);
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
