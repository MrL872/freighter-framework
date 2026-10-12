package com.example.application.workercontrollers.nmap;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Server-side allowlist of nmap CLI flags, mirroring
 * frontend/public/js/components/worker_components/nmap-panel.js's
 * FLAG_SECTIONS exactly. The frontend already restricts what a user can
 * toggle, but that is a UI convenience, not a security boundary --
 * everything arriving at NmapController#run is untrusted and re-validated
 * here before it is ever turned into argv for the worker's nmap process.
 */
public final class NmapFlags {
    private static final int MAX_VALUE_LENGTH = 4096;

    // flag -> takes a value
    private static final Map<String, Boolean> ALLOWED = new LinkedHashMap<>();
    // Flags whose value names a Project Folder file (see ProjectFileStager)
    // rather than an arbitrary typed value -- mirrors nmap-panel.js's isFile.
    private static final Set<String> FILE_FLAGS = new LinkedHashSet<>();
    static {
        ALLOWED.put("-iL", true); FILE_FLAGS.add("-iL");
        ALLOWED.put("-iR", true);
        ALLOWED.put("--exclude", true);
        ALLOWED.put("--excludefile", true); FILE_FLAGS.add("--excludefile");

        ALLOWED.put("-sL", false);
        ALLOWED.put("-sn", false);
        ALLOWED.put("-Pn", false);
        ALLOWED.put("-PS", true);
        ALLOWED.put("-PA", true);
        ALLOWED.put("-PU", true);
        ALLOWED.put("-PY", true);
        ALLOWED.put("-PE", false);
        ALLOWED.put("-PP", false);
        ALLOWED.put("-PM", false);
        ALLOWED.put("-PO", true);
        ALLOWED.put("-n", false);
        ALLOWED.put("-R", false);
        ALLOWED.put("--dns-servers", true);
        ALLOWED.put("--system-dns", false);
        ALLOWED.put("--traceroute", false);

        ALLOWED.put("-sS", false);
        ALLOWED.put("-sT", false);
        ALLOWED.put("-sA", false);
        ALLOWED.put("-sW", false);
        ALLOWED.put("-sM", false);
        ALLOWED.put("-sU", false);
        ALLOWED.put("-sN", false);
        ALLOWED.put("-sF", false);
        ALLOWED.put("-sX", false);
        ALLOWED.put("--scanflags", true);
        ALLOWED.put("-sI", true);
        ALLOWED.put("-sY", false);
        ALLOWED.put("-sZ", false);
        ALLOWED.put("-sO", false);
        ALLOWED.put("-b", true);

        ALLOWED.put("-p", true);
        ALLOWED.put("--exclude-ports", true);
        ALLOWED.put("-F", false);
        ALLOWED.put("-r", false);
        ALLOWED.put("--top-ports", true);
        ALLOWED.put("--port-ratio", true);

        ALLOWED.put("-sV", false);
        ALLOWED.put("--version-intensity", true);
        ALLOWED.put("--version-light", false);
        ALLOWED.put("--version-all", false);
        ALLOWED.put("--version-trace", false);

        ALLOWED.put("-sC", false);
        ALLOWED.put("--script", true);
        ALLOWED.put("--script-args", true);
        ALLOWED.put("--script-args-file", true); FILE_FLAGS.add("--script-args-file");
        ALLOWED.put("--script-trace", false);
        ALLOWED.put("--script-updatedb", false);
        ALLOWED.put("--script-help", true);

        ALLOWED.put("-O", false);
        ALLOWED.put("--osscan-limit", false);
        ALLOWED.put("--osscan-guess", false);

        ALLOWED.put("-T", true);
        ALLOWED.put("--min-hostgroup", true);
        ALLOWED.put("--max-hostgroup", true);
        ALLOWED.put("--min-parallelism", true);
        ALLOWED.put("--max-parallelism", true);
        ALLOWED.put("--min-rtt-timeout", true);
        ALLOWED.put("--max-rtt-timeout", true);
        ALLOWED.put("--initial-rtt-timeout", true);
        ALLOWED.put("--max-retries", true);
        ALLOWED.put("--host-timeout", true);
        ALLOWED.put("--scan-delay", true);
        ALLOWED.put("--max-scan-delay", true);
        ALLOWED.put("--min-rate", true);
        ALLOWED.put("--max-rate", true);

        ALLOWED.put("-f", false);
        ALLOWED.put("--mtu", true);
        ALLOWED.put("-D", true);
        ALLOWED.put("-S", true);
        ALLOWED.put("-e", true);
        ALLOWED.put("-g", true);
        ALLOWED.put("--proxies", true);
        ALLOWED.put("--data", true);
        ALLOWED.put("--data-string", true);
        ALLOWED.put("--data-length", true);
        ALLOWED.put("--ip-options", true);
        ALLOWED.put("--ttl", true);
        ALLOWED.put("--spoof-mac", true);
        ALLOWED.put("--badsum", false);

        ALLOWED.put("-oN", true);
        ALLOWED.put("-oX", true);
        ALLOWED.put("-oS", true);
        ALLOWED.put("-oG", true);
        ALLOWED.put("-oA", true);
        ALLOWED.put("-v", false);
        ALLOWED.put("-d", false);
        ALLOWED.put("--reason", false);
        ALLOWED.put("--open", false);
        ALLOWED.put("--packet-trace", false);
        ALLOWED.put("--iflist", false);
        ALLOWED.put("--append-output", false);
        ALLOWED.put("--resume", true); FILE_FLAGS.add("--resume");
        ALLOWED.put("--noninteractive", false);
        ALLOWED.put("--stylesheet", true);
        ALLOWED.put("--webxml", false);
        ALLOWED.put("--no-stylesheet", false);

        ALLOWED.put("-6", false);
        ALLOWED.put("-A", false);
        ALLOWED.put("--datadir", true);
        ALLOWED.put("--send-eth", false);
        ALLOWED.put("--send-ip", false);
        ALLOWED.put("--privileged", false);
        ALLOWED.put("--unprivileged", false);
        ALLOWED.put("-V", false);
    }

    private NmapFlags() {}

    public static boolean isFileFlag(String flag) {
        return FILE_FLAGS.contains(flag);
    }

    // Flags whose value is an isOutput pick in nmap-panel.js's
    // FLAG_SECTIONS -- the file nmap itself writes while running is staged
    // back into the selected profile's Project Folder once the run
    // completes. See NmapRunService.start()/collectOutputs() and
    // WorkerOutputStager. -oX is deliberately excluded: nmap-worker/main.go's
    // ensureXMLOutput() only forces "-oX -" (XML to stdout, which findings
    // parsing reads) when the caller hasn't already set -oX themselves --
    // staging would rewrite -oX to a real file path and silently break
    // findings extraction for that run. -oA (a <basename>.nmap/.xml/.gnmap
    // trio, not a single file) is excluded for the same reason
    // WorkerOutputStager's own class docstring gives for every other
    // directory/multi-file output flag in this codebase.
    private static final Set<String> OUTPUT_FLAGS = Set.of("-oN", "-oS", "-oG", "-oX");

    public static boolean isOutputFlag(String flag) {
        return OUTPUT_FLAGS.contains(flag);
    }

    /**
     * Turns a {flag: value} map (value is "" for boolean flags) into a
     * validated argv list, in allowlist order so the built command is
     * deterministic. Rejects anything not in ALLOWED, any value that's blank
     * for a value-taking flag, oversized values, or values containing
     * control characters -- os/exec on the worker side never invokes a
     * shell, so this isn't an injection vector, but a stray newline/control
     * char has no legitimate reason to be in a CLI arg here.
     *
     * Unlike SubfinderFlags, there is no single required "target" flag here
     * -- nmap-panel.js has no bare target input of its own (only file-backed
     * target flags like -iL), so this only enforces that at least one flag
     * was supplied.
     */
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
                throw new IllegalArgumentException("Unsupported nmap flag: " + key);
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
