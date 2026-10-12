package com.example.application.workercontrollers.dirsearch;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Server-side allowlist of dirsearch CLI flags. The flag set follows FLAG_SECTIONS in
 * frontend/public/js/components/worker_components/dirsearch-panel.js. The frontend already restricts what a
 * user can toggle, but that is a UI convenience, not a security boundary: everything arriving at
 * DirsearchController#run is untrusted and is re-validated here before it is turned into argv for the worker's
 * dirsearch process. Used by DirsearchRunService.
 */
public final class DirsearchFlags {
    private static final int MAX_VALUE_LENGTH = 4096;

    private static final Map<String, Boolean> ALLOWED = new LinkedHashMap<>();
    private static final Set<String> FILE_FLAGS = new LinkedHashSet<>();
    static {
        // Generated from FLAG_SECTIONS in dirsearch-panel.js (the same flag set the panel can
        // emit); keep the two in sync by regenerating, not by hand.
        ALLOWED.put("-u", true);
        ALLOWED.put("-l", true); FILE_FLAGS.add("-l");
        ALLOWED.put("--stdin", false);
        ALLOWED.put("--cidr", true);
        ALLOWED.put("--raw", true); FILE_FLAGS.add("--raw");
        ALLOWED.put("--nmap-report", true); FILE_FLAGS.add("--nmap-report");
        ALLOWED.put("-s", true); FILE_FLAGS.add("-s");
        ALLOWED.put("--session-id", true);
        ALLOWED.put("--config", true); FILE_FLAGS.add("--config");
        ALLOWED.put("-w", true); FILE_FLAGS.add("-w");
        ALLOWED.put("--wordlist-categories", true);
        ALLOWED.put("--wordlist-backend", true);
        ALLOWED.put("--wordlist-max-size", true);
        ALLOWED.put("-e", true);
        ALLOWED.put("-f", false);
        ALLOWED.put("--overwrite-extensions", false);
        ALLOWED.put("--exclude-extensions", true);
        ALLOWED.put("--prefixes", true);
        ALLOWED.put("--suffixes", true);
        ALLOWED.put("-U", false);
        ALLOWED.put("-L", false);
        ALLOWED.put("-C", false);
        ALLOWED.put("-o", true);
        ALLOWED.put("-O", true);
        ALLOWED.put("--mysql-url", true);
        ALLOWED.put("--postgres-url", true);
        ALLOWED.put("--log", true);
        ALLOWED.put("-t", true);
        ALLOWED.put("--sessions-dir", true); FILE_FLAGS.add("--sessions-dir");
        ALLOWED.put("-a", false);
        ALLOWED.put("--sync", false);
        ALLOWED.put("-r", false);
        ALLOWED.put("--deep-recursive", false);
        ALLOWED.put("--force-recursive", false);
        ALLOWED.put("-R", true);
        ALLOWED.put("--recursion-status", true);
        ALLOWED.put("--filter-threshold", true);
        ALLOWED.put("--subdirs", true);
        ALLOWED.put("--exclude-subdirs", true);
        ALLOWED.put("--auto-calibration", false);
        ALLOWED.put("-i", true);
        ALLOWED.put("-x", true);
        ALLOWED.put("--exclude-sizes", true);
        ALLOWED.put("--exclude-text", true);
        ALLOWED.put("--exclude-regex", true);
        ALLOWED.put("--exclude-redirect", true);
        ALLOWED.put("--exclude-response", true); FILE_FLAGS.add("--exclude-response");
        ALLOWED.put("--skip-on-status", true);
        ALLOWED.put("--min-response-size", true);
        ALLOWED.put("--max-response-size", true);
        ALLOWED.put("--max-time", true);
        ALLOWED.put("--target-max-time", true);
        ALLOWED.put("--exit-on-error", false);
        ALLOWED.put("--match-status", true);
        ALLOWED.put("--filter-status", true);
        ALLOWED.put("--match-size", true);
        ALLOWED.put("--filter-size", true);
        ALLOWED.put("--match-words", true);
        ALLOWED.put("--filter-words", true);
        ALLOWED.put("--match-lines", true);
        ALLOWED.put("--filter-lines", true);
        ALLOWED.put("--match-regex", true);
        ALLOWED.put("--filter-regex", true);
        ALLOWED.put("--match-header", true);
        ALLOWED.put("--filter-header", true);
        ALLOWED.put("--match-header-regex", true);
        ALLOWED.put("--filter-header-regex", true);
        ALLOWED.put("--match-time", true);
        ALLOWED.put("--filter-time", true);
        ALLOWED.put("--matcher-mode", true);
        ALLOWED.put("--filter-mode", true);
        ALLOWED.put("-m", true);
        ALLOWED.put("--request-backend", true);
        ALLOWED.put("-d", true);
        ALLOWED.put("--data-file", true); FILE_FLAGS.add("--data-file");
        ALLOWED.put("-H", true);
        ALLOWED.put("--headers-file", true); FILE_FLAGS.add("--headers-file");
        ALLOWED.put("-F", false);
        ALLOWED.put("--random-agent", false);
        ALLOWED.put("--auth", true);
        ALLOWED.put("--auth-type", true);
        ALLOWED.put("--cert-file", true); FILE_FLAGS.add("--cert-file");
        ALLOWED.put("--key-file", true); FILE_FLAGS.add("--key-file");
        ALLOWED.put("--user-agent", true);
        ALLOWED.put("--cookie", true);
        ALLOWED.put("--timeout", true);
        ALLOWED.put("--delay", true);
        ALLOWED.put("--proxy", true);
        ALLOWED.put("--proxies-file", true); FILE_FLAGS.add("--proxies-file");
        ALLOWED.put("--proxy-auth", true);
        ALLOWED.put("--replay-proxy", true);
        ALLOWED.put("--tor", false);
        ALLOWED.put("--scheme", true);
        ALLOWED.put("--max-rate", true);
        ALLOWED.put("--retries", true);
        ALLOWED.put("--ip", true);
        ALLOWED.put("--interface", true);
        ALLOWED.put("--crawl", false);
        ALLOWED.put("--full-url", false);
        ALLOWED.put("--redirects-history", false);
        ALLOWED.put("--no-color", false);
        ALLOWED.put("-q", false);
        ALLOWED.put("--disable-cli", false);
        ALLOWED.put("-v", false);
    }

    // A run needs a target. dirsearch-panel.js's MANDATORY section offers several
    // alternative ways to supply one; toArgs() accepts any of them.
    private static final Set<String> TARGET_FLAGS = Set.of("-u", "-l", "--stdin", "--raw", "--cidr", "--nmap-report", "-s", "--session-id");

    private DirsearchFlags() {}

    public static boolean isFileFlag(String flag) {
        return FILE_FLAGS.contains(flag);
    }

    // Flags whose value is an isOutput pick in dirsearch-panel.js's
    // FLAG_SECTIONS -- the file dirsearch itself writes while running is
    // staged back into the selected profile's Project Folder once the run
    // completes. See DirsearchRunService.start()/collectOutputs() and
    // WorkerOutputStager. dirsearch-worker/server.py keeps a caller's -o file
    // as the run's report, so -o is staged like --log.
    private static final Set<String> OUTPUT_FLAGS = Set.of("-o", "--log");

    public static boolean isOutputFlag(String flag) {
        return OUTPUT_FLAGS.contains(flag);
    }

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
                throw new IllegalArgumentException("Unsupported dirsearch flag: " + key);
            }
        }
        boolean hasTarget = flags.keySet().stream().anyMatch(TARGET_FLAGS::contains);
        if (!hasTarget) {
            throw new IllegalArgumentException("A run requires one of -u, -l, --stdin, --raw, --cidr, --nmap-report, -s, or --session-id");
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
