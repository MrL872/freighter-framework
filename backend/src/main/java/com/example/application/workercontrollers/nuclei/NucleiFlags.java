package com.example.application.workercontrollers.nuclei;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Server-side allowlist of nuclei CLI flags. The sections follow the FLAG_SECTIONS in
 * frontend/public/js/components/worker_components/nuclei-panel.js (TARGET, TARGET-FORMAT, TEMPLATES,
 * FILTERING, OUTPUT, CONFIGURATIONS, INTERACTSH, FUZZING, UNCOVER, RATE-LIMIT, OPTIMIZATIONS,
 * HEADLESS, DEBUG, UPDATE, HONEYPOT, STATISTICS, CLOUD, AUTHENTICATION). The frontend limits what
 * a user can toggle, but that is a UI convenience, not a security boundary. Every flag set arriving
 * at NucleiController#run is untrusted and is validated here before it becomes argv for the
 * worker's nuclei process.
 *
 * The worker (workers/nuclei-worker/main.go) always appends "-jsonl" after this argv so the output
 * is parseable. Setting -j or -jsonl here is redundant but harmless.
 */
public final class NucleiFlags {
    private static final int MAX_VALUE_LENGTH = 2048;

    // flag -> takes a value
    private static final Map<String, Boolean> ALLOWED = new LinkedHashMap<>();
    static {
        // TARGET
        ALLOWED.put("-u", true);
        ALLOWED.put("-l", true);
        ALLOWED.put("-targets-inline", true);
        ALLOWED.put("-eh", true);
        ALLOWED.put("-resume", true);
        ALLOWED.put("-sa", false);
        ALLOWED.put("-iv", true);
        // TARGET-FORMAT
        ALLOWED.put("-im", true);
        ALLOWED.put("-ro", false);
        ALLOWED.put("-sfv", false);
        ALLOWED.put("-vtt", false);
        ALLOWED.put("-vfp", true);
        // TEMPLATES
        ALLOWED.put("-nt", false);
        ALLOWED.put("-ntv", true);
        ALLOWED.put("-as", false);
        ALLOWED.put("-t", true);
        ALLOWED.put("-turl", true);
        ALLOWED.put("-ai", true);
        ALLOWED.put("-w", true);
        ALLOWED.put("-wurl", true);
        ALLOWED.put("-validate", false);
        ALLOWED.put("-nss", false);
        ALLOWED.put("-td", false);
        ALLOWED.put("-tl", false);
        ALLOWED.put("-tgl", false);
        ALLOWED.put("-sign", false);
        ALLOWED.put("-code", false);
        ALLOWED.put("-dut", false);
        ALLOWED.put("-esc", false);
        ALLOWED.put("-egm", false);
        ALLOWED.put("-file", false);
        // FILTERING
        ALLOWED.put("-a", true);
        ALLOWED.put("-tags", true);
        ALLOWED.put("-etags", true);
        ALLOWED.put("-itags", true);
        ALLOWED.put("-id", true);
        ALLOWED.put("-eid", true);
        ALLOWED.put("-it", true);
        ALLOWED.put("-et", true);
        ALLOWED.put("-em", true);
        ALLOWED.put("-s", true);
        ALLOWED.put("-es", true);
        ALLOWED.put("-pt", true);
        ALLOWED.put("-ept", true);
        ALLOWED.put("-tc", true);
        // OUTPUT
        ALLOWED.put("-o", true);
        ALLOWED.put("-sresp", false);
        ALLOWED.put("-srd", true);
        ALLOWED.put("-silent", false);
        ALLOWED.put("-nc", false);
        ALLOWED.put("-j", false);
        ALLOWED.put("-irr", false);
        ALLOWED.put("-or", false);
        ALLOWED.put("-ot", false);
        ALLOWED.put("-nm", false);
        ALLOWED.put("-ts", false);
        ALLOWED.put("-rdb", true);
        ALLOWED.put("-ms", false);
        ALLOWED.put("-me", true);
        ALLOWED.put("-se", true);
        ALLOWED.put("-je", true);
        ALLOWED.put("-jle", true);
        ALLOWED.put("-pe", true);
        ALLOWED.put("-rd", true);
        // CONFIGURATIONS
        ALLOWED.put("-config", true);
        ALLOWED.put("-tp", true);
        ALLOWED.put("-tpl", false);
        ALLOWED.put("-fr", false);
        ALLOWED.put("-fhr", false);
        ALLOWED.put("-mr", true);
        ALLOWED.put("-dr", false);
        ALLOWED.put("-rc", true);
        ALLOWED.put("-H", true);
        ALLOWED.put("-V", true);
        ALLOWED.put("-r", true);
        ALLOWED.put("-sr", false);
        ALLOWED.put("-dc", false);
        ALLOWED.put("-passive", false);
        ALLOWED.put("-fh2", false);
        ALLOWED.put("-ev", false);
        ALLOWED.put("-cc", true);
        ALLOWED.put("-ck", true);
        ALLOWED.put("-ca", true);
        ALLOWED.put("-sml", false);
        ALLOWED.put("-ztls", false);
        ALLOWED.put("-sni", true);
        ALLOWED.put("-dka", true);
        ALLOWED.put("-lfa", false);
        ALLOWED.put("-lna", false);
        ALLOWED.put("-i", true);
        ALLOWED.put("-at", true);
        ALLOWED.put("-sip", true);
        ALLOWED.put("-rsr", true);
        ALLOWED.put("-rss", true);
        ALLOWED.put("-reset", false);
        ALLOWED.put("-tlsi", false);
        ALLOWED.put("-hae", true);
        // INTERACTSH
        ALLOWED.put("-iserver", true);
        ALLOWED.put("-itoken", true);
        ALLOWED.put("-interactions-cache-size", true);
        ALLOWED.put("-interactions-eviction", true);
        ALLOWED.put("-interactions-poll-duration", true);
        ALLOWED.put("-interactions-cooldown-period", true);
        ALLOWED.put("-ni", false);
        // FUZZING
        ALLOWED.put("-ft", true);
        ALLOWED.put("-fm", true);
        ALLOWED.put("-fuzz", false);
        ALLOWED.put("-dast", false);
        ALLOWED.put("-dts", false);
        ALLOWED.put("-dtr", false);
        ALLOWED.put("-dtst", true);
        ALLOWED.put("-dtsa", true);
        ALLOWED.put("-dfp", false);
        ALLOWED.put("-fuzz-param-frequency", true);
        ALLOWED.put("-fa", true);
        ALLOWED.put("-cs", true);
        ALLOWED.put("-cos", true);
        // UNCOVER
        ALLOWED.put("-uc", false);
        ALLOWED.put("-uq", true);
        ALLOWED.put("-ue", true);
        ALLOWED.put("-uf", true);
        ALLOWED.put("-ul", true);
        ALLOWED.put("-ur", true);
        // RATE-LIMIT
        ALLOWED.put("-rl", true);
        ALLOWED.put("-rld", true);
        ALLOWED.put("-rlm", true);
        ALLOWED.put("-bs", true);
        ALLOWED.put("-c", true);
        ALLOWED.put("-hbs", true);
        ALLOWED.put("-headc", true);
        ALLOWED.put("-jsc", true);
        ALLOWED.put("-pc", true);
        ALLOWED.put("-prc", true);
        ALLOWED.put("-tlc", true);
        // OPTIMIZATIONS
        ALLOWED.put("-timeout", true);
        ALLOWED.put("-retries", true);
        ALLOWED.put("-ldp", false);
        ALLOWED.put("-mhe", true);
        ALLOWED.put("-te", true);
        ALLOWED.put("-nmhe", false);
        ALLOWED.put("-project", false);
        ALLOWED.put("-project-path", true);
        ALLOWED.put("-spm", false);
        ALLOWED.put("-stream", false);
        ALLOWED.put("-ss", true);
        ALLOWED.put("-irt", true);
        ALLOWED.put("-nh", false);
        ALLOWED.put("-no-stdin", false);
        // HEADLESS
        ALLOWED.put("-headless", false);
        ALLOWED.put("-page-timeout", true);
        ALLOWED.put("-sb", false);
        ALLOWED.put("-ho", true);
        ALLOWED.put("-sc", false);
        ALLOWED.put("-cdpe", true);
        ALLOWED.put("-lha", false);
        // DEBUG
        ALLOWED.put("-debug", false);
        ALLOWED.put("-dreq", false);
        ALLOWED.put("-dresp", false);
        ALLOWED.put("-p", true);
        ALLOWED.put("-pi", false);
        ALLOWED.put("-ldf", false);
        ALLOWED.put("-tlog", true);
        ALLOWED.put("-elog", true);
        ALLOWED.put("-version", false);
        ALLOWED.put("-hm", false);
        ALLOWED.put("-v", false);
        ALLOWED.put("-profile-mem", true);
        ALLOWED.put("-vv", false);
        ALLOWED.put("-svd", false);
        ALLOWED.put("-vdl", true);
        ALLOWED.put("-ep", false);
        ALLOWED.put("-tv", false);
        ALLOWED.put("-hc", false);
        // UPDATE
        ALLOWED.put("-ut", false);
        ALLOWED.put("-ud", true);
        ALLOWED.put("-duc", false);
        // HONEYPOT
        ALLOWED.put("-hpd", false);
        ALLOWED.put("-hpt", true);
        ALLOWED.put("-shp", false);
        // STATISTICS
        ALLOWED.put("-stats", false);
        ALLOWED.put("-sj", false);
        ALLOWED.put("-si", true);
        ALLOWED.put("-mp", true);
        ALLOWED.put("-hps", false);
        // CLOUD
        ALLOWED.put("-auth", false);
        ALLOWED.put("-tid", true);
        ALLOWED.put("-cup", false);
        ALLOWED.put("-sid", true);
        ALLOWED.put("-sname", true);
        ALLOWED.put("-pd", false);
        ALLOWED.put("-pdu", true);
        // AUTHENTICATION
        ALLOWED.put("-sf", true);
        ALLOWED.put("-ps", false);
    }

    // Flags whose value is a file picked from the Project Folder in nuclei-panel.js.
    // NucleiRunService resolves these through ProjectFileStager before toArgs() sees them.
    private static final java.util.Set<String> FILE_FLAGS = java.util.Set.of(
        "-l", "-resume", "-vfp", "-t", "-w", "-it", "-et", "-cc", "-ck", "-ca",
        "-sf", "-config", "-tp", "-rc", "-r");

    public static boolean isFileFlag(String flag) {
        return FILE_FLAGS.contains(flag);
    }

    // Flags whose value is an output file picked in nuclei-panel.js. The file nuclei writes during the
    // run is staged back into the selected profile's Project Folder after the run completes (see
    // NucleiRunService.start() and collectOutputs(), and WorkerOutputStager). The findings come from
    // the JSONL on stdout, which nuclei-worker/main.go always requests with "-jsonl", so rewriting these
    // paths does not change findings extraction. -srd, -rdb, and -me are left out on purpose because
    // they name directories or databases rather than single files (see WorkerOutputStager).
    private static final java.util.Set<String> OUTPUT_FLAGS = java.util.Set.of(
        "-o", "-se", "-je", "-jle", "-pe", "-tlog", "-elog");

    public static boolean isOutputFlag(String flag) {
        return OUTPUT_FLAGS.contains(flag);
    }

    private NucleiFlags() {}

    /**
     * Turns a {flag: value} map (value is "" for boolean flags) into a
     * validated argv list, in allowlist order so the built command is
     * deterministic. Rejects anything not in ALLOWED, any value that's
     * blank for a value-taking flag, oversized values, or values containing
     * control characters. Requires at least one of -u/-l so a run always has
     * a target.
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
                throw new IllegalArgumentException("Unsupported nuclei flag: " + key);
            }
        }
        if (!flags.containsKey("-u") && !flags.containsKey("-l")) {
            throw new IllegalArgumentException("A run requires -u or -l");
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
