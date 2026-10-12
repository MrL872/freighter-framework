package com.example.application.workercontrollers.masscan;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Server-side allowlist of masscan CLI flags, mirroring
 * frontend/public/js/components/worker_components/masscan-panel.js's
 * FLAG_SECTIONS exactly. The frontend already restricts what a user can
 * toggle, but that is a UI convenience, not a security boundary --
 * everything arriving at MasscanController#run is untrusted and
 * re-validated here before it is ever turned into argv for the worker's
 * masscan process.
 *
 * The flag set follows masscan's own "masscan --nmap" output (the
 * nmap-equivalent reference masscan ships for users coming from nmap), the
 * same ground-truth source used for the rest of this run's flag options,
 * plus "-c" for an external config file (confirmed in "masscan --help").
 * masscan-worker/main.go has no /output or /pause /resume routes (unlike
 * nmap-worker), so output-writing flags here are plain value flags, not
 * staged back into Project Folder the way NmapFlags.OUTPUT_FLAGS are.
 */
public final class MasscanFlags {
    private static final int MAX_VALUE_LENGTH = 4096;
    private static final String BARE_TARGET_KEY = "target";

    // flag -> takes a value
    private static final Map<String, Boolean> ALLOWED = new LinkedHashMap<>();
    // Flags whose value names a Project Folder or shared configs/wordlists
    // file (see ProjectFileStager) rather than an arbitrary typed value --
    // mirrors masscan-panel.js's isFile.
    private static final Set<String> FILE_FLAGS = new LinkedHashSet<>();
    static {
        // TARGET SPECIFICATION
        ALLOWED.put("-iL", true); FILE_FLAGS.add("-iL");
        ALLOWED.put("--exclude", true);
        ALLOWED.put("--excludefile", true); FILE_FLAGS.add("--excludefile");
        ALLOWED.put("--randomize-hosts", false);

        // HOST DISCOVERY
        ALLOWED.put("-Pn", false);
        ALLOWED.put("-n", false);

        // SCAN TECHNIQUES
        ALLOWED.put("-sS", false);

        // SERVICE/VERSION DETECTION
        ALLOWED.put("--banners", false);

        // PORT SPECIFICATION AND SCAN ORDER
        ALLOWED.put("-p", true);

        // TIMING AND PERFORMANCE
        ALLOWED.put("--max-rate", true);
        ALLOWED.put("--connection-timeout", true);

        // FIREWALL/IDS EVASION AND SPOOFING
        ALLOWED.put("-S", true);
        ALLOWED.put("-e", true);
        ALLOWED.put("-g", true);
        ALLOWED.put("--ttl", true);
        ALLOWED.put("--spoof-mac", true);

        // OUTPUT
        ALLOWED.put("--output-format", true);
        ALLOWED.put("--output-file", true);
        ALLOWED.put("-oL", true);
        ALLOWED.put("-oJ", true);
        ALLOWED.put("-oD", true);
        ALLOWED.put("-oG", true);
        ALLOWED.put("-oB", true);
        ALLOWED.put("-oX", true);
        ALLOWED.put("-oU", true);
        ALLOWED.put("-v", false);
        ALLOWED.put("-d", false);
        ALLOWED.put("--open", false);
        ALLOWED.put("--packet-trace", false);
        ALLOWED.put("--iflist", false);
        ALLOWED.put("--append-output", false);
        ALLOWED.put("--resume", true); FILE_FLAGS.add("--resume");

        // MISC
        ALLOWED.put("--send-eth", false);
        ALLOWED.put("-c", true); FILE_FLAGS.add("-c");
    }

    // A run needs a target: either the bare "target" entry masscan-panel.js's
    // MANDATORY section offers, or -iL (a host list file).
    private static final Set<String> TARGET_FLAGS = Set.of(BARE_TARGET_KEY, "-iL");

    private MasscanFlags() {}

    public static boolean isFileFlag(String flag) {
        return FILE_FLAGS.contains(flag);
    }

    /**
     * Turns a {flag: value} map (value is "" for boolean flags) into a
     * validated argv list, in allowlist order so the built command is
     * deterministic, with the bare target (if present) emitted first with
     * no leading flag token. Rejects anything not in ALLOWED, any value
     * that's blank for a value-taking flag, oversized values, or values
     * containing control characters -- os/exec on the worker side never
     * invokes a shell, so this isn't an injection vector, but a stray
     * newline/control char has no legitimate reason to be in a CLI arg
     * here.
     */
    public static List<String> toArgs(Map<String, String> flags) {
        if (flags == null || flags.isEmpty()) {
            throw new IllegalArgumentException("At least one flag is required");
        }
        List<String> args = new ArrayList<>();
        String target = flags.get(BARE_TARGET_KEY);
        if (target != null) {
            if (target.isBlank() || target.length() > MAX_VALUE_LENGTH || hasControlCharacters(target)) {
                throw new IllegalArgumentException("target has an invalid value");
            }
            args.add(target);
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
            if (!key.equals(BARE_TARGET_KEY) && !ALLOWED.containsKey(key)) {
                throw new IllegalArgumentException("Unsupported masscan flag: " + key);
            }
        }
        boolean hasTarget = flags.keySet().stream().anyMatch(TARGET_FLAGS::contains);
        if (!hasTarget) {
            throw new IllegalArgumentException("A run requires a target or -iL");
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
