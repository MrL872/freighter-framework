package com.example.application.settings;

import java.net.URI;
import java.net.URISyntaxException;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import com.example.application.chat.OpenAiCompatibleLlmClient;
import com.example.application.settings.TelegramSettingsStore.Chat;
import com.example.application.settings.TelegramSettingsStore.Settings;

/**
 * Settings endpoints: GET /settings, PUT /settings/telegram, PUT /settings/mcp,
 * PUT /settings/llm and POST /settings/telegram/send. Reads and writes through
 * TelegramSettingsStore, McpSettingsStore and LlmSettingsStore, and sends documents
 * through TelegramClient. The backend is the only thing that changes these files,
 * and it checks every value first. The Telegram token and the LLM API key are
 * accepted here but never returned.
 */
@RestController
public class SettingsController {

    private static final Pattern TOKEN = Pattern.compile("^\\d{5,}:[A-Za-z0-9_-]{30,}$");
    private static final Pattern CHAT_ID = Pattern.compile("^(-?\\d{1,20}|@[A-Za-z][A-Za-z0-9_]{4,})$");
    private static final int MAX_CHATS = 20;
    private static final int MAX_LABEL = 60;
    static final int MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
    private static final DateTimeFormatter STAMP = DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss");

    public record ChatInput(String label, String chatId) {}
    public record TelegramUpdate(String token, List<ChatInput> chats) {}
    /** workers maps a worker name to whether it is offered over MCP. */
    public record McpUpdate(Integer defaultTimeoutSeconds, Map<String, Boolean> workers) {}
    /** apiKey left blank or missing keeps the current one. */
    public record LlmUpdate(Boolean cloudEnabled, String apiKey) {}
    /** apiKey left blank or missing keeps the current one. baseUrl gets "/v1" appended when it has no path of its own. */
    public record LocalLlmUpdate(Boolean enabled, String baseUrl, String apiKey, String model) {}
    /** Lists the models a (not necessarily yet saved) server reports, so the form can offer a picker before saving. */
    public record LocalLlmModelsRequest(String baseUrl, String apiKey) {}
    public record SendRequest(String content, String chatId) {}

    private final TelegramSettingsStore telegram;
    private final McpSettingsStore mcp;
    private final LlmSettingsStore llm;
    private final LocalLlmSettingsStore localLlm;
    private final TelegramClient client;

    public SettingsController(TelegramSettingsStore telegram, McpSettingsStore mcp, LlmSettingsStore llm,
                               LocalLlmSettingsStore localLlm, TelegramClient client) {
        this.telegram = telegram;
        this.mcp = mcp;
        this.llm = llm;
        this.localLlm = localLlm;
        this.client = client;
    }

    @GetMapping("/settings")
    public ResponseEntity<?> get() {
        return guarded(() -> {
            Settings t = telegram.load();
            List<Map<String, String>> chats = new ArrayList<>();
            for (Chat c : t.chats()) chats.add(Map.of("label", c.label(), "chatId", c.chatId()));
            McpSettingsStore.McpSettings m = mcp.load();
            List<Map<String, Object>> workers = new ArrayList<>();
            for (McpSettingsStore.Worker w : m.workers()) {
                workers.add(Map.of("name", w.name(), "mode", w.mode(), "enabled", w.enabled()));
            }
            LlmSettingsStore.Settings l = llm.load();
            LocalLlmSettingsStore.Settings local = localLlm.load();
            LocalLlmSettingsStore.Effective localEffective = localLlm.effective();
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("telegram", Map.of("configured", t.configured(), "chats", chats));
            out.put("mcp", Map.of("defaultTimeoutSeconds", m.defaultTimeoutSeconds(), "workers", workers));
            out.put("llm", Map.of("cloudEnabled", l.cloudEnabled(), "configured", !llm.effectiveApiKey().isBlank()));
            out.put("localLlm", Map.of(
                "enabled", local.enabled(),
                "baseUrl", local.baseUrl(),
                "model", local.model(),
                "keySet", !localEffective.apiKey().isBlank(),
                "configured", localEffective.configured()));
            return out;
        });
    }

    /**
     * Saves the bot token (blank or missing keeps the current one) and the chat list.
     * A chat's label is shown in the UI, and its chatId is the Telegram chat or channel.
     */
    @PutMapping("/settings/telegram")
    public ResponseEntity<?> putTelegram(@RequestBody TelegramUpdate request) {
        return guarded(() -> {
            Settings current = telegram.load();
            String token = current.token();
            if (request.token() != null && !request.token().isBlank()) {
                if (!TOKEN.matcher(request.token().trim()).matches()) {
                    throw new IllegalArgumentException("the bot token does not look like a Telegram token (123456:ABC...)");
                }
                token = request.token().trim();
            }
            List<ChatInput> inputs = request.chats() == null ? List.of() : request.chats();
            if (inputs.size() > MAX_CHATS) {
                throw new IllegalArgumentException("at most " + MAX_CHATS + " chats");
            }
            List<Chat> chats = new ArrayList<>();
            for (ChatInput in : inputs) {
                String chatId = in.chatId() == null ? "" : in.chatId().trim();
                String label = in.label() == null ? "" : in.label().trim();
                if (!CHAT_ID.matcher(chatId).matches()) {
                    throw new IllegalArgumentException("chat id must be a number such as -1001234567890, or @channelname");
                }
                if (label.length() > MAX_LABEL) {
                    throw new IllegalArgumentException("chat label must be at most " + MAX_LABEL + " characters");
                }
                chats.add(new Chat(label.isEmpty() ? chatId : label, chatId));
            }
            telegram.save(new Settings(token, chats));
            return Map.of("configured", token != null && !token.isBlank(), "chats", chats.size());
        });
    }

    /** Changes the default timeout and which workers are offered over MCP. The gateway reloads the file. */
    @PutMapping("/settings/mcp")
    public ResponseEntity<?> putMcp(@RequestBody McpUpdate request) {
        return guarded(() -> {
            mcp.update(request.defaultTimeoutSeconds(), request.workers());
            return Map.of("saved", true);
        });
    }

    /**
     * Turns the cloud (Anthropic) model on or off and saves the API key (blank or
     * missing keeps the current one). Takes effect on the chat agent's next request --
     * no restart needed, since ChatService reads this store, not a fixed env var.
     */
    @PutMapping("/settings/llm")
    public ResponseEntity<?> putLlm(@RequestBody LlmUpdate request) {
        return guarded(() -> {
            LlmSettingsStore.Settings current = llm.load();
            boolean enabled = request.cloudEnabled() == null ? current.cloudEnabled() : request.cloudEnabled();
            String apiKey = request.apiKey() != null && !request.apiKey().isBlank() ? request.apiKey().trim() : current.apiKey();
            llm.save(new LlmSettingsStore.Settings(enabled, apiKey));
            return Map.of("cloudEnabled", enabled, "configured", !llm.effectiveApiKey().isBlank());
        });
    }

    /**
     * Turns the local (OpenAI-compatible: LM Studio, Ollama, ...) model on or
     * off and saves its base URL, API key (blank or missing keeps the current
     * one) and model id. baseUrl gets "/v1" appended when it has no path of
     * its own, so saving "http://host:1234" works the same as typing
     * "http://host:1234/v1". Takes effect on the chat agent's next request --
     * no restart needed, since ChatService reads this store, not fixed env vars.
     */
    @PutMapping("/settings/llm-local")
    public ResponseEntity<?> putLocalLlm(@RequestBody LocalLlmUpdate request) {
        return guarded(() -> {
            LocalLlmSettingsStore.Settings current = localLlm.load();
            boolean enabled = request.enabled() == null ? current.enabled() : request.enabled();
            String baseUrl = request.baseUrl() == null || request.baseUrl().isBlank()
                ? current.baseUrl() : normalizeBaseUrl(request.baseUrl());
            String apiKey = request.apiKey() != null && !request.apiKey().isBlank() ? request.apiKey().trim() : current.apiKey();
            String model = request.model() == null || request.model().isBlank() ? current.model() : request.model().trim();
            localLlm.save(new LocalLlmSettingsStore.Settings(enabled, baseUrl, apiKey, model));
            LocalLlmSettingsStore.Effective effective = localLlm.effective();
            return Map.of("enabled", enabled, "baseUrl", baseUrl, "model", model, "configured", effective.configured());
        });
    }

    /**
     * Turns the cloud model off and forgets its saved API key, so the Settings
     * dialog's "forget" button leaves nothing behind for ANTHROPIC_API_KEY (if
     * set) to silently take back over as the fallback would otherwise suggest --
     * forgetting is a deliberate, explicit opt out, not just a blank field.
     */
    @DeleteMapping("/settings/llm")
    public ResponseEntity<?> deleteLlm() {
        return guarded(() -> {
            llm.save(new LlmSettingsStore.Settings(false, ""));
            return Map.of("cloudEnabled", false, "configured", false);
        });
    }

    /** Turns the local model off and forgets its saved base URL, API key and model id -- same contract as deleteLlm above. */
    @DeleteMapping("/settings/llm-local")
    public ResponseEntity<?> deleteLocalLlm() {
        return guarded(() -> {
            localLlm.save(new LocalLlmSettingsStore.Settings(false, "", "", ""));
            return Map.of("enabled", false, "baseUrl", "", "model", "", "configured", false);
        });
    }

    /**
     * Lists the model ids a server reports right now (GET {base}/models), for
     * the local model form's "fetch available models" step. Takes the base
     * URL/key from the request body rather than the saved settings, so this
     * works before the first save too -- the browser never needs to guess
     * whether a key it's about to save actually works.
     */
    @PostMapping("/settings/llm-local/models")
    public ResponseEntity<?> listLocalLlmModels(@RequestBody LocalLlmModelsRequest request) {
        return guarded(() -> {
            if (request.baseUrl() == null || request.baseUrl().isBlank()) {
                throw new IllegalArgumentException("base URL is required");
            }
            String baseUrl = normalizeBaseUrl(request.baseUrl());
            try {
                List<String> models = OpenAiCompatibleLlmClient.listModels(baseUrl, request.apiKey());
                return Map.of("baseUrl", baseUrl, "models", models);
            } catch (java.io.IOException | InterruptedException e) {
                throw new IllegalStateException("could not reach the server: " + e.getMessage());
            }
        });
    }

    private static String normalizeBaseUrl(String baseUrl) {
        String normalized = OpenAiCompatibleLlmClient.normalizeBaseUrl(baseUrl);
        try {
            URI uri = new URI(normalized);
            if (uri.getHost() == null || (!"http".equals(uri.getScheme()) && !"https".equals(uri.getScheme()))) {
                throw new IllegalArgumentException("base URL must be a valid http:// or https:// URL");
            }
        } catch (URISyntaxException e) {
            throw new IllegalArgumentException("base URL must be a valid http:// or https:// URL");
        }
        return normalized;
    }

    /** Sends the raw output as a .md document to one chat, or to every configured chat when chatId is blank. */
    @PostMapping("/settings/telegram/send")
    public ResponseEntity<?> send(@RequestBody SendRequest request) {
        if (request.content() == null || request.content().isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "there is no output to send"));
        }
        byte[] bytes = request.content().getBytes(java.nio.charset.StandardCharsets.UTF_8);
        if (bytes.length > MAX_OUTPUT_BYTES) {
            return ResponseEntity.badRequest().body(Map.of("error", "output is larger than 2 MB"));
        }
        return guarded(() -> {
            Settings t = telegram.load();
            if (!t.configured()) {
                throw new IllegalStateException("the Telegram bot is not configured");
            }
            List<Chat> targets = new ArrayList<>();
            for (Chat c : t.chats()) {
                if (request.chatId() == null || request.chatId().isBlank() || request.chatId().equals(c.chatId())) {
                    targets.add(c);
                }
            }
            if (targets.isEmpty()) {
                throw new IllegalArgumentException("no configured chat matches that chat id");
            }
            String filename = "freighter-output-" + LocalDateTime.now().format(STAMP) + ".md";
            List<Map<String, Object>> results = new ArrayList<>();
            for (Chat c : targets) {
                try {
                    client.sendDocument(t.token(), c.chatId(), filename, "text/markdown", bytes);
                    results.add(Map.of("label", c.label(), "ok", true));
                } catch (IllegalStateException e) {
                    results.add(Map.of("label", c.label(), "ok", false, "error", String.valueOf(e.getMessage())));
                }
            }
            return Map.of("filename", filename, "results", results);
        });
    }

    @FunctionalInterface
    private interface Work {
        Object run();
    }

    /** Bad input is 400; missing configuration or a failed upstream call is 502. Messages never include the token. */
    private ResponseEntity<?> guarded(Work work) {
        try {
            return ResponseEntity.ok(work.run());
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(Map.of("error", e.getMessage()));
        } catch (java.io.UncheckedIOException e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("error", "settings file error: " + e.getCause().getMessage()));
        }
    }
}
