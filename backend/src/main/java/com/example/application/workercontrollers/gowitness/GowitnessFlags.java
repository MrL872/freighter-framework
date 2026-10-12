package com.example.application.workercontrollers.gowitness;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Server-side allowlist of gowitness CLI flags. The flag set follows FLAG_SECTIONS in
 * frontend/public/js/components/worker_components/gowitness-panel.js, and each flag's scan subcommands
 * (COMMANDS) were checked against `gowitness scan <cmd> --help` for gowitness v3. The frontend already
 * restricts what a user can toggle, but that is a UI convenience, not a security boundary: everything
 * arriving at GowitnessController#run is untrusted and is re-validated here before it is turned into argv
 * for the worker's gowitness process.
 *
 * gowitness v3 has no screenshot command. Screenshots come from its scan subcommands (single, file, cidr,
 * nmap, nessus), and a run names exactly one of them. toArgs() builds ["scan", <subcommand>, ...flags].
 * Used by GowitnessRunService.
 */
public final class GowitnessFlags {
    private static final int MAX_VALUE_LENGTH = 4096;

    /**
     * Where screenshots are written when the caller names no --screenshot-path. The worker only streams the
     * screenshots it finds in that folder, so a run without a path would show no images.
     */
    public static final String DEFAULT_SCREENSHOT_PATH = "/tmp/screenshots";

    private static final Set<String> BARE_COMMANDS = Set.of("single", "file", "cidr", "nmap", "nessus");

    // flag -> takes a value
    private static final Map<String, Boolean> ALLOWED = new LinkedHashMap<>();
    // flag -> the scan subcommands the flag belongs to
    private static final Map<String, Set<String>> COMMANDS = new LinkedHashMap<>();
    private static final Set<String> FILE_FLAGS = Set.of("--file", "--cidr-file", "--javascript-file");
    static {
        ALLOWED.put("--url", true);
        ALLOWED.put("--file", true);
        ALLOWED.put("--cidr", true);
        ALLOWED.put("--cidr-file", true);
        ALLOWED.put("--no-http", false);
        ALLOWED.put("--no-https", false);
        ALLOWED.put("--port", true);
        ALLOWED.put("--ports-small", false);
        ALLOWED.put("--ports-medium", false);
        ALLOWED.put("--ports-large", false);
        ALLOWED.put("--random", false);
        ALLOWED.put("--open-only", false);
        ALLOWED.put("--service", true);
        ALLOWED.put("--service-contains", true);
        ALLOWED.put("--exclude-port", true);
        ALLOWED.put("--skip-port", true);
        ALLOWED.put("--hostnames", false);
        ALLOWED.put("--plugin-name", true);
        ALLOWED.put("--plugin-output", true);
        ALLOWED.put("--service-name", true);
        ALLOWED.put("--screenshot-path", true);
        ALLOWED.put("--screenshot-format", true);
        ALLOWED.put("--screenshot-fullpage", false);
        ALLOWED.put("--screenshot-jpeg-quality", true);
        ALLOWED.put("--screenshot-skip-save", false);
        ALLOWED.put("--write-screenshots", false);
        ALLOWED.put("--javascript", true);
        ALLOWED.put("--javascript-file", true);
        ALLOWED.put("--http-code-filter", true);
        ALLOWED.put("--uri-filter", true);
        ALLOWED.put("--chrome-proxy", true);
        ALLOWED.put("--chrome-header", true);
        ALLOWED.put("--chrome-wss-url", true);
        ALLOWED.put("--chrome-path", true);
        ALLOWED.put("--chrome-user-data-dir", true);
        ALLOWED.put("--chrome-window-x", true);
        ALLOWED.put("--chrome-window-y", true);
        ALLOWED.put("--chrome-user-agent", true);
        ALLOWED.put("--driver", true);
        ALLOWED.put("--write-db", false);
        ALLOWED.put("--write-db-uri", true);
        ALLOWED.put("--write-db-enable-debug", false);
        ALLOWED.put("--write-csv", false);
        ALLOWED.put("--write-csv-file", true);
        ALLOWED.put("--write-jsonl", false);
        ALLOWED.put("--write-jsonl-file", true);
        ALLOWED.put("--write-none", false);
        ALLOWED.put("--write-stdout", false);
        ALLOWED.put("--save-content", false);
        ALLOWED.put("--skip-html", false);
        ALLOWED.put("--skip-network-logs", false);
        ALLOWED.put("--delay", true);
        ALLOWED.put("--timeout", true);
        ALLOWED.put("--threads", true);
        ALLOWED.put("--quiet", false);
        ALLOWED.put("--debug-log", false);
        ALLOWED.put("--log-scan-errors", false);
        ALLOWED.put("--no-log-color", false);
        ALLOWED.put("--profile", false);
        COMMANDS.put("--url", Set.of("single"));
        COMMANDS.put("--file", Set.of("file", "nmap", "nessus"));
        COMMANDS.put("--cidr", Set.of("cidr"));
        COMMANDS.put("--cidr-file", Set.of("cidr"));
        COMMANDS.put("--no-http", Set.of("file", "cidr", "nmap", "nessus"));
        COMMANDS.put("--no-https", Set.of("file", "cidr", "nmap", "nessus"));
        COMMANDS.put("--port", Set.of("file", "cidr", "nmap", "nessus"));
        COMMANDS.put("--ports-small", Set.of("file", "cidr"));
        COMMANDS.put("--ports-medium", Set.of("file", "cidr"));
        COMMANDS.put("--ports-large", Set.of("file", "cidr"));
        COMMANDS.put("--random", Set.of("cidr"));
        COMMANDS.put("--open-only", Set.of("nmap"));
        COMMANDS.put("--service", Set.of("nmap"));
        COMMANDS.put("--service-contains", Set.of("nmap"));
        COMMANDS.put("--exclude-port", Set.of("nmap"));
        COMMANDS.put("--skip-port", Set.of("nmap"));
        COMMANDS.put("--hostnames", Set.of("nmap", "nessus"));
        COMMANDS.put("--plugin-name", Set.of("nessus"));
        COMMANDS.put("--plugin-output", Set.of("nessus"));
        COMMANDS.put("--service-name", Set.of("nessus"));
        COMMANDS.put("--screenshot-path", Set.of("single", "file", "cidr", "nmap", "nessus"));
        COMMANDS.put("--screenshot-format", Set.of("single", "file", "cidr", "nmap", "nessus"));
        COMMANDS.put("--screenshot-fullpage", Set.of("single", "file", "cidr", "nmap", "nessus"));
        COMMANDS.put("--screenshot-jpeg-quality", Set.of("single", "file", "cidr", "nmap", "nessus"));
        COMMANDS.put("--screenshot-skip-save", Set.of("single", "file", "cidr", "nmap", "nessus"));
        COMMANDS.put("--write-screenshots", Set.of("single", "file", "cidr", "nmap", "nessus"));
        COMMANDS.put("--javascript", Set.of("single", "file", "cidr", "nmap", "nessus"));
        COMMANDS.put("--javascript-file", Set.of("single", "file", "cidr", "nmap", "nessus"));
        COMMANDS.put("--http-code-filter", Set.of("single", "file", "cidr", "nmap", "nessus"));
        COMMANDS.put("--uri-filter", Set.of("single", "file", "cidr", "nmap", "nessus"));
        COMMANDS.put("--chrome-proxy", Set.of("single", "file", "cidr", "nmap", "nessus"));
        COMMANDS.put("--chrome-header", Set.of("single", "file", "cidr", "nmap", "nessus"));
        COMMANDS.put("--chrome-wss-url", Set.of("single", "file", "cidr", "nmap", "nessus"));
        COMMANDS.put("--chrome-path", Set.of("single", "file", "cidr", "nmap", "nessus"));
        COMMANDS.put("--chrome-user-data-dir", Set.of("single", "file", "cidr", "nmap", "nessus"));
        COMMANDS.put("--chrome-window-x", Set.of("single", "file", "cidr", "nmap", "nessus"));
        COMMANDS.put("--chrome-window-y", Set.of("single", "file", "cidr", "nmap", "nessus"));
        COMMANDS.put("--chrome-user-agent", Set.of("single", "file", "cidr", "nmap", "nessus"));
        COMMANDS.put("--driver", Set.of("single", "file", "cidr", "nmap", "nessus"));
        COMMANDS.put("--write-db", Set.of("single", "file", "cidr", "nmap", "nessus"));
        COMMANDS.put("--write-db-uri", Set.of("single", "file", "cidr", "nmap", "nessus"));
        COMMANDS.put("--write-db-enable-debug", Set.of("single", "file", "cidr", "nmap", "nessus"));
        COMMANDS.put("--write-csv", Set.of("single", "file", "cidr", "nmap", "nessus"));
        COMMANDS.put("--write-csv-file", Set.of("single", "file", "cidr", "nmap", "nessus"));
        COMMANDS.put("--write-jsonl", Set.of("single", "file", "cidr", "nmap", "nessus"));
        COMMANDS.put("--write-jsonl-file", Set.of("single", "file", "cidr", "nmap", "nessus"));
        COMMANDS.put("--write-none", Set.of("single", "file", "cidr", "nmap", "nessus"));
        COMMANDS.put("--write-stdout", Set.of("single", "file", "cidr", "nmap", "nessus"));
        COMMANDS.put("--save-content", Set.of("single", "file", "cidr", "nmap", "nessus"));
        COMMANDS.put("--skip-html", Set.of("single", "file", "cidr", "nmap", "nessus"));
        COMMANDS.put("--skip-network-logs", Set.of("single", "file", "cidr", "nmap", "nessus"));
        COMMANDS.put("--delay", Set.of("single", "file", "cidr", "nmap", "nessus"));
        COMMANDS.put("--timeout", Set.of("single", "file", "cidr", "nmap", "nessus"));
        COMMANDS.put("--threads", Set.of("single", "file", "cidr", "nmap", "nessus"));
        COMMANDS.put("--quiet", Set.of("single", "file", "cidr", "nmap", "nessus"));
        COMMANDS.put("--debug-log", Set.of("single", "file", "cidr", "nmap", "nessus"));
        COMMANDS.put("--log-scan-errors", Set.of("single", "file", "cidr", "nmap", "nessus"));
        COMMANDS.put("--no-log-color", Set.of("single", "file", "cidr", "nmap", "nessus"));
        COMMANDS.put("--profile", Set.of("single", "file", "cidr", "nmap", "nessus"));
    }

    public static boolean isFileFlag(String flag) {
        return FILE_FLAGS.contains(flag);
    }

    private GowitnessFlags() {}

    /**
     * Turns a {flag: value} map into a validated argv list: one scan command (a bare key in BARE_COMMANDS),
     * then every allowlisted flag that the command takes. Rejects zero or several scan commands, a flag that
     * is not allowlisted or not valid for the chosen command, a missing target for that command, blank or
     * oversized values, and values with control characters.
     */
    public static List<String> toArgs(Map<String, String> flags) {
        if (flags == null || flags.isEmpty()) {
            throw new IllegalArgumentException("A run requires a scan command (single, file, cidr, nmap or nessus)");
        }
        List<String> commands = new ArrayList<>();
        for (String key : flags.keySet()) {
            if (BARE_COMMANDS.contains(key)) commands.add(key);
        }
        if (commands.isEmpty()) {
            throw new IllegalArgumentException("A run requires a scan command (single, file, cidr, nmap or nessus)");
        }
        if (commands.size() > 1) {
            throw new IllegalArgumentException("Only one scan command may be active at a time");
        }
        String command = commands.get(0);

        for (String key : flags.keySet()) {
            if (BARE_COMMANDS.contains(key)) continue;
            if (!ALLOWED.containsKey(key)) {
                throw new IllegalArgumentException("Unsupported gowitness flag: " + key);
            }
            if (!COMMANDS.get(key).contains(command)) {
                throw new IllegalArgumentException("Flag " + key + " is not valid for scan " + command);
            }
        }

        List<String> args = new ArrayList<>();
        args.add("scan");
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
        if (!flags.containsKey("--screenshot-path")) {
            args.add("--screenshot-path");
            args.add(DEFAULT_SCREENSHOT_PATH);
        }
        requireTarget(command, flags);
        return args;
    }

    // Each scan subcommand reads its targets from a different flag.
    private static void requireTarget(String command, Map<String, String> flags) {
        boolean hasTarget = switch (command) {
            case "single" -> flags.containsKey("--url");
            case "file", "nmap", "nessus" -> flags.containsKey("--file");
            case "cidr" -> flags.containsKey("--cidr") || flags.containsKey("--cidr-file");
            default -> false;
        };
        if (!hasTarget) {
            throw new IllegalArgumentException(switch (command) {
                case "single" -> "scan single requires --url";
                case "cidr" -> "scan cidr requires --cidr or --cidr-file";
                default -> "scan " + command + " requires --file";
            });
        }
    }

    private static boolean hasControlCharacters(String value) {
        for (int i = 0; i < value.length(); i++) {
            if (Character.isISOControl(value.charAt(i))) return true;
        }
        return false;
    }
}
