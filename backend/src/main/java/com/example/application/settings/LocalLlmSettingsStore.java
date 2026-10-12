package com.example.application.settings;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.PosixFilePermission;
import java.util.EnumSet;
import java.util.Set;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * Whether the chat agent's local, OpenAI-compatible model (LM Studio, Ollama,
 * ...) is offered, and the base URL/API key/model it uses. Kept on the server
 * in its own directory under ./data (settings.local-llm-dir, /data/local-llm
 * in compose), the same file-backed pattern as LlmSettingsStore (the
 * Anthropic equivalent) and TelegramSettingsStore. Only this class reads or
 * writes the file; SettingsController is its caller, and ChatService reads
 * effective() to build the OpenAiCompatibleLlmClient. The browser gets
 * whether a key is set, never the key itself.
 *
 * When no base URL/model has been saved through this store, the
 * LLM_BASE_URL/LLM_API_KEY/LLM_MODEL environment variables (chat.openai-
 * compatible.*) are used instead, so a deployment that already relies on
 * those env vars keeps working without anyone opening Settings.
 */
@Component
public class LocalLlmSettingsStore {

    public record Settings(boolean enabled, String baseUrl, String apiKey, String model) {}

    /** What ChatService actually needs to build a client, after the env-var fallback. */
    public record Effective(boolean enabled, String baseUrl, String apiKey, String model) {
        public boolean configured() { return !baseUrl.isBlank() && !model.isBlank(); }
    }

    private static final Set<PosixFilePermission> OWNER_ONLY =
        EnumSet.of(PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE);

    private final ObjectMapper mapper = new ObjectMapper();
    private final Path dir;
    private final Path file;
    private final String envBaseUrl;
    private final String envApiKey;
    private final String envModel;

    public LocalLlmSettingsStore(@Value("${settings.local-llm-dir:../data/local-llm}") String dir,
                                  @Value("${chat.openai-compatible.base-url:}") String envBaseUrl,
                                  @Value("${chat.openai-compatible.api-key:}") String envApiKey,
                                  @Value("${chat.openai-compatible.model:}") String envModel) {
        this.dir = Path.of(dir).toAbsolutePath().normalize();
        this.file = this.dir.resolve("settings.json");
        this.envBaseUrl = envBaseUrl == null ? "" : envBaseUrl;
        this.envApiKey = envApiKey == null ? "" : envApiKey;
        this.envModel = envModel == null ? "" : envModel;
    }

    public synchronized Settings load() {
        if (!Files.exists(file)) {
            return new Settings(true, "", "", "");
        }
        try {
            JsonNode root = mapper.readTree(Files.readString(file, StandardCharsets.UTF_8));
            return new Settings(root.path("enabled").asBoolean(true), root.path("baseUrl").asString(""),
                root.path("apiKey").asString(""), root.path("model").asString(""));
        } catch (IOException e) {
            throw new UncheckedIOException("cannot read local LLM settings", e);
        }
    }

    public synchronized void save(Settings settings) {
        ObjectNode root = mapper.createObjectNode();
        root.put("enabled", settings.enabled());
        root.put("baseUrl", settings.baseUrl() == null ? "" : settings.baseUrl());
        root.put("apiKey", settings.apiKey() == null ? "" : settings.apiKey());
        root.put("model", settings.model() == null ? "" : settings.model());
        try {
            Files.createDirectories(dir);
            Path tmp = Files.createTempFile(dir, "settings", ".tmp");
            Files.writeString(tmp, mapper.writerWithDefaultPrettyPrinter().writeValueAsString(root), StandardCharsets.UTF_8);
            restrict(tmp);
            Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            restrict(file);
        } catch (IOException e) {
            throw new UncheckedIOException("cannot write local LLM settings", e);
        }
    }

    /** What ChatService should actually use right now, falling back to the env vars field by field. */
    public Effective effective() {
        Settings s = load();
        String baseUrl = s.baseUrl().isBlank() ? envBaseUrl : s.baseUrl();
        String apiKey = s.apiKey().isBlank() ? envApiKey : s.apiKey();
        String model = s.model().isBlank() ? envModel : s.model();
        return new Effective(s.enabled(), baseUrl, apiKey, model);
    }

    /** Owner-only permissions where the file system supports them (Linux, WSL). */
    private static void restrict(Path p) {
        try {
            Files.setPosixFilePermissions(p, OWNER_ONLY);
        } catch (UnsupportedOperationException | IOException ignored) {
            // Windows file systems have no POSIX permissions.
        }
    }
}
