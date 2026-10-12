package com.example.application.workercontrollers.wpscan;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Server-side allowlist of wpscan CLI flags. The sections follow the FLAG_SECTIONS in
 * frontend/public/js/components/worker_components/wpscan-panel.js, which were taken from
 * .github/worker_instructions/wpscan.md (the `wpscan --help` output). The help, version, and update flags
 * are not in the allowlist. The frontend limits what a user can toggle, but that is a UI convenience, not a
 * security boundary. Every flag set arriving at WpscanController#run is untrusted and is validated here
 * before it becomes argv for the worker's wpscan process.
 *
 * wpscan has no bare positional target. --url is a regular flag and is required.
 */
public final class WpscanFlags {
    private static final int MAX_VALUE_LENGTH = 2048;
    private static final String REQUIRED_FLAG = "--url";

    // flag -> takes a value
    private static final Map<String, Boolean> ALLOWED = new LinkedHashMap<>();
    static {
        // target
        ALLOWED.put("--url", true);
        ALLOWED.put("--force", false);
        // enumeration
        ALLOWED.put("-e", true);
        ALLOWED.put("--exclude-content-based", true);
        ALLOWED.put("--plugins-detection", true);
        ALLOWED.put("--plugins-version-detection", true);
        ALLOWED.put("--exclude-usernames", true);
        // password attack
        ALLOWED.put("-P", true);
        ALLOWED.put("-U", true);
        ALLOWED.put("--password-attack", true);
        ALLOWED.put("--login-uri", true);
        ALLOWED.put("--multicall-max-passwords", true);
        ALLOWED.put("--stealthy", false);
        // auth / api
        ALLOWED.put("--api-token", true);
        ALLOWED.put("--http-auth", true);
        // network
        ALLOWED.put("--user-agent", true);
        ALLOWED.put("--random-user-agent", false);
        ALLOWED.put("-t", true);
        ALLOWED.put("--throttle", true);
        ALLOWED.put("--request-timeout", true);
        ALLOWED.put("--connect-timeout", true);
        ALLOWED.put("--disable-tls-checks", false);
        ALLOWED.put("--proxy", true);
        ALLOWED.put("--proxy-auth", true);
        ALLOWED.put("--cookie-string", true);
        ALLOWED.put("--cookie-jar", true);
        ALLOWED.put("--detection-mode", true);
        // wordpress
        ALLOWED.put("--wp-content-dir", true);
        ALLOWED.put("--wp-plugins-dir", true);
        // output
        ALLOWED.put("-v", false);
        ALLOWED.put("--no-banner", false);
        ALLOWED.put("-o", true);
        ALLOWED.put("-f", true);
    }

    // Flags whose value is a file picked from the Project Folder in wpscan-panel.js.
    // WpscanRunService resolves these through ProjectFileStager before toArgs() sees them.
    private static final java.util.Set<String> FILE_FLAGS = java.util.Set.of("-P");

    public static boolean isFileFlag(String flag) {
        return FILE_FLAGS.contains(flag);
    }

    // Flags whose value is an output file picked in wpscan-panel.js. The file wpscan writes during the run is
    // staged into the selected profile's Project Folder after the run completes (see
    // WpscanRunService.start() and collectOutputs(), and WorkerOutputStager). Findings come from the "[!] "
    // alert lines that workers/wpscan-worker/main.go matches on stdout, not from the -o file, so rewriting it
    // does not change findings extraction.
    private static final java.util.Set<String> OUTPUT_FLAGS = java.util.Set.of("-o", "--cookie-jar");

    public static boolean isOutputFlag(String flag) {
        return OUTPUT_FLAGS.contains(flag);
    }

    private WpscanFlags() {}

    /**
     * Turns a {flag: value} map into a validated argv list. Requires REQUIRED_FLAG (--url) to be present and
     * non-blank, because wpscan has nothing to scan without a target URL.
     */
    public static List<String> toArgs(Map<String, String> flags) {
        if (flags == null || flags.isEmpty() || !flags.containsKey(REQUIRED_FLAG)) {
            throw new IllegalArgumentException("Flag " + REQUIRED_FLAG + " (target URL) is required");
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
                throw new IllegalArgumentException("Unsupported wpscan flag: " + key);
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
