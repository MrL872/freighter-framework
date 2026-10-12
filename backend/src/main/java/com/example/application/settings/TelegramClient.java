package com.example.application.settings;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Outgoing messages only. Sends a document to one chat through the Telegram Bot
 * API (sendDocument). The token is part of the request URL, so error text is
 * scrubbed of it before it is returned. SettingsController is its caller.
 */
@Component
public class TelegramClient {

    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    private final ObjectMapper mapper = new ObjectMapper();
    private final String apiBase;

    public TelegramClient(@Value("${settings.telegram-api-base:https://api.telegram.org}") String apiBase) {
        this.apiBase = apiBase.endsWith("/") ? apiBase.substring(0, apiBase.length() - 1) : apiBase;
    }

    /** Sends one document. Throws IllegalStateException with a token-free message on failure. */
    public void sendDocument(String token, String chatId, String filename, String mimeType, byte[] content) {
        String boundary = "freighter-" + UUID.randomUUID();
        byte[] body = multipart(boundary, chatId, filename, mimeType, content);
        try {
            HttpRequest request = HttpRequest.newBuilder(URI.create(apiBase + "/bot" + token + "/sendDocument"))
                .timeout(Duration.ofSeconds(60))
                .header("Content-Type", "multipart/form-data; boundary=" + boundary)
                .POST(HttpRequest.BodyPublishers.ofByteArray(body))
                .build();
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
            JsonNode json = mapper.readTree(response.body());
            if (response.statusCode() / 100 != 2 || !json.path("ok").asBoolean(false)) {
                String description = json.path("description").asString("HTTP " + response.statusCode());
                throw new IllegalStateException(scrub(description, token));
            }
        } catch (IOException e) {
            throw new IllegalStateException(scrub("Telegram is unreachable: " + e.getMessage(), token), e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("interrupted while sending to Telegram", e);
        }
    }

    private static byte[] multipart(String boundary, String chatId, String filename, String mimeType, byte[] content) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        String dash = "--" + boundary + "\r\n";
        writeText(out, dash + "Content-Disposition: form-data; name=\"chat_id\"\r\n\r\n" + chatId + "\r\n");
        writeText(out, dash + "Content-Disposition: form-data; name=\"document\"; filename=\"" + filename + "\"\r\n"
            + "Content-Type: " + mimeType + "\r\n\r\n");
        out.writeBytes(content);
        writeText(out, "\r\n--" + boundary + "--\r\n");
        return out.toByteArray();
    }

    private static void writeText(ByteArrayOutputStream out, String s) {
        out.writeBytes(s.getBytes(StandardCharsets.UTF_8));
    }

    static String scrub(String message, String token) {
        return token == null || token.isEmpty() ? message : message.replace(token, "[token]");
    }
}
