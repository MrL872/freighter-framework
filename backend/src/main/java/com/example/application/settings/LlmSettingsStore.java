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
 * Whether the chat agent's cloud (Anthropic) model is offered, and the API key
 * it uses. Kept on the server in its own directory under ./data
 * (settings.llm-dir, /data/llm in compose), the same pattern as
 * TelegramSettingsStore. Only this class reads or writes the file;
 * SettingsController is its caller, and ChatService reads effectiveApiKey() to
 * build the Anthropic client. The browser gets whether a key is set, never the
 * key itself.
 *
 * When no key has been saved through this store, ANTHROPIC_API_KEY (the
 * environment variable docker-compose sets from .env) is used instead, so a
 * deployment that already relies on that env var keeps working without
 * anyone opening Settings.
 */
@Component
public class LlmSettingsStore {

    public record Settings(boolean cloudEnabled, String apiKey) {}

    private static final Set<PosixFilePermission> OWNER_ONLY =
        EnumSet.of(PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE);

    private final ObjectMapper mapper = new ObjectMapper();
    private final Path dir;
    private final Path file;
    private final String envApiKey;

    public LlmSettingsStore(@Value("${settings.llm-dir:../data/llm}") String dir,
                             @Value("${chat.anthropic.api-key:}") String envApiKey) {
        this.dir = Path.of(dir).toAbsolutePath().normalize();
        this.file = this.dir.resolve("settings.json");
        this.envApiKey = envApiKey == null ? "" : envApiKey;
    }

    public synchronized Settings load() {
        if (!Files.exists(file)) {
            return new Settings(true, "");
        }
        try {
            JsonNode root = mapper.readTree(Files.readString(file, StandardCharsets.UTF_8));
            return new Settings(root.path("cloudEnabled").asBoolean(true), root.path("apiKey").asString(""));
        } catch (IOException e) {
            throw new UncheckedIOException("cannot read LLM settings", e);
        }
    }

    public synchronized void save(Settings settings) {
        ObjectNode root = mapper.createObjectNode();
        root.put("cloudEnabled", settings.cloudEnabled());
        root.put("apiKey", settings.apiKey() == null ? "" : settings.apiKey());
        try {
            Files.createDirectories(dir);
            Path tmp = Files.createTempFile(dir, "settings", ".tmp");
            Files.writeString(tmp, mapper.writerWithDefaultPrettyPrinter().writeValueAsString(root), StandardCharsets.UTF_8);
            restrict(tmp);
            Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            restrict(file);
        } catch (IOException e) {
            throw new UncheckedIOException("cannot write LLM settings", e);
        }
    }

    /** The key actually used for the cloud model right now, or blank if it is unavailable. */
    public String effectiveApiKey() {
        Settings s = load();
        if (!s.cloudEnabled()) return "";
        return s.apiKey().isBlank() ? envApiKey : s.apiKey();
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
