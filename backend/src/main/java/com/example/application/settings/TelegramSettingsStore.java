package com.example.application.settings;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.PosixFilePermission;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * Telegram bot settings, kept on the server in their own directory under ./data
 * (settings.telegram-dir, /data/telegram in compose). Only this class reads or
 * writes the file; SettingsController is its caller. The browser gets the token's
 * presence, never the token.
 */
@Component
public class TelegramSettingsStore {

    public record Chat(String label, String chatId) {}

    public record Settings(String token, List<Chat> chats) {
        public boolean configured() {
            return token != null && !token.isBlank();
        }
    }

    private static final Set<PosixFilePermission> OWNER_ONLY =
        EnumSet.of(PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE);

    private final ObjectMapper mapper = new ObjectMapper();
    private final Path dir;
    private final Path file;

    public TelegramSettingsStore(@Value("${settings.telegram-dir:../data/telegram}") String dir) {
        this.dir = Path.of(dir).toAbsolutePath().normalize();
        this.file = this.dir.resolve("settings.json");
    }

    public synchronized Settings load() {
        if (!Files.exists(file)) {
            return new Settings("", List.of());
        }
        try {
            JsonNode root = mapper.readTree(Files.readString(file, StandardCharsets.UTF_8));
            List<Chat> chats = new ArrayList<>();
            for (JsonNode c : root.path("chats")) {
                chats.add(new Chat(c.path("label").asString(""), c.path("chatId").asString("")));
            }
            return new Settings(root.path("token").asString(""), chats);
        } catch (IOException e) {
            throw new UncheckedIOException("cannot read Telegram settings", e);
        }
    }

    public synchronized void save(Settings settings) {
        ObjectNode root = mapper.createObjectNode();
        root.put("token", settings.token() == null ? "" : settings.token());
        ArrayNode chats = root.putArray("chats");
        for (Chat c : settings.chats()) {
            chats.addObject().put("label", c.label()).put("chatId", c.chatId());
        }
        try {
            Files.createDirectories(dir);
            Path tmp = Files.createTempFile(dir, "settings", ".tmp");
            Files.writeString(tmp, mapper.writerWithDefaultPrettyPrinter().writeValueAsString(root), StandardCharsets.UTF_8);
            restrict(tmp);
            Files.move(tmp, file, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            restrict(file);
        } catch (IOException e) {
            throw new UncheckedIOException("cannot write Telegram settings", e);
        }
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
