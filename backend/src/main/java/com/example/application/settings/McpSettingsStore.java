package com.example.application.settings;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * Reads and changes the MCP gateway's config file (settings.mcp-gateway-config,
 * ./data/mcp-gateway/config.json). The gateway itself mounts that folder
 * read-only and reloads the file when it changes. This is the only writer, and
 * SettingsController is its caller.
 */
@Component
public class McpSettingsStore {

    public static final int MAX_TIMEOUT_SECONDS = 86_400;

    public record Worker(String name, String mode, boolean enabled) {}
    public record McpSettings(int defaultTimeoutSeconds, List<Worker> workers) {}

    private final ObjectMapper mapper = new ObjectMapper();
    private final Path file;

    public McpSettingsStore(@Value("${settings.mcp-gateway-config:../data/mcp-gateway/config.json}") String path) {
        this.file = Path.of(path).toAbsolutePath().normalize();
    }

    public synchronized McpSettings load() {
        ObjectNode root = read();
        List<Worker> workers = new ArrayList<>();
        root.path("workers").properties().forEach(e -> workers.add(new Worker(
            e.getKey(),
            e.getValue().path("mode").asString("local"),
            !e.getValue().has("enabled") || e.getValue().path("enabled").asBoolean(true))));
        return new McpSettings(root.path("defaultTimeoutSeconds").asInt(300), workers);
    }

    /**
     * Applies a change. Each value is checked first, and nothing is written if any
     * check fails. Unknown worker names are rejected.
     */
    public synchronized void update(Integer defaultTimeoutSeconds, Map<String, Boolean> enabledByWorker) {
        ObjectNode root = read();
        if (defaultTimeoutSeconds != null) {
            if (defaultTimeoutSeconds < 1 || defaultTimeoutSeconds > MAX_TIMEOUT_SECONDS) {
                throw new IllegalArgumentException("defaultTimeoutSeconds must be between 1 and " + MAX_TIMEOUT_SECONDS);
            }
            root.put("defaultTimeoutSeconds", defaultTimeoutSeconds);
        }
        if (enabledByWorker != null) {
            JsonNode workers = root.path("workers");
            for (Map.Entry<String, Boolean> e : enabledByWorker.entrySet()) {
                if (!workers.has(e.getKey()) || !(workers.get(e.getKey()) instanceof ObjectNode worker)) {
                    throw new IllegalArgumentException("unknown worker: " + e.getKey());
                }
                if (e.getValue() == null) {
                    throw new IllegalArgumentException("enabled must be true or false for " + e.getKey());
                }
                worker.put("enabled", e.getValue());
            }
        }
        write(root);
    }

    private ObjectNode read() {
        try {
            JsonNode root = mapper.readTree(Files.readString(file, StandardCharsets.UTF_8));
            if (!(root instanceof ObjectNode obj)) {
                throw new IllegalStateException("MCP gateway config is not a JSON object");
            }
            return obj;
        } catch (IOException e) {
            throw new UncheckedIOException("cannot read MCP gateway config at " + file, e);
        }
    }

    /** Write to a temporary file in the same folder, then move it over the original. */
    private void write(ObjectNode root) {
        try {
            Path tmp = Files.createTempFile(file.getParent(), "config", ".tmp");
            Files.writeString(tmp, mapper.writerWithDefaultPrettyPrinter().writeValueAsString(root), StandardCharsets.UTF_8);
            Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (IOException e) {
            throw new UncheckedIOException("cannot write MCP gateway config", e);
        }
    }
}
