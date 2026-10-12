package com.example.application.chat;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

import com.example.application.chat.LlmTypes.Msg;
import com.example.application.chat.LlmTypes.Reply;
import com.example.application.chat.LlmTypes.ToolCall;
import com.example.application.chat.LlmTypes.ToolSpec;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * OpenAI-compatible chat completions (POST {base}/chat/completions). Works with
 * Ollama (http://host:11434/v1), LM Studio, and OpenAI itself. The API key is
 * optional, since local servers usually need none. ChatService creates one per request.
 */
public class OpenAiCompatibleLlmClient implements LlmClient {
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    private final ObjectMapper mapper = new ObjectMapper();
    private final String baseUrl;
    private final String apiKey;
    private final String model;

    public OpenAiCompatibleLlmClient(String baseUrl, String apiKey, String model) {
        this.baseUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
        this.apiKey = apiKey;
        this.model = model;
    }

    /**
     * Adds the "/v1" API prefix LM Studio, Ollama and most other
     * OpenAI-compatible servers expect, when the given base doesn't already
     * have a path of its own -- so saving "http://host:1234" in Settings
     * works the same as typing "http://host:1234/v1" yourself. A base that
     * already has any path (its own "/v1", or something else entirely) is
     * left untouched.
     */
    public static String normalizeBaseUrl(String baseUrl) {
        String trimmed = baseUrl.trim();
        if (trimmed.isEmpty()) return trimmed;
        String noSlash = trimmed.endsWith("/") ? trimmed.substring(0, trimmed.length() - 1) : trimmed;
        URI uri = URI.create(noSlash);
        String path = uri.getPath();
        return (path == null || path.isEmpty()) ? noSlash + "/v1" : noSlash;
    }

    /**
     * Lists model ids the server at this base currently reports (GET
     * {base}/models), for the Settings UI's "fetch available models" step.
     * Thrown exceptions carry a message safe to show the user; they never
     * include the API key.
     */
    public static List<String> listModels(String baseUrl, String apiKey) throws IOException, InterruptedException {
        String base = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(base + "/models"))
            .timeout(Duration.ofSeconds(10))
            .GET();
        if (apiKey != null && !apiKey.isBlank()) {
            builder.header("authorization", "Bearer " + apiKey);
        }
        HttpResponse<String> response = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build()
            .send(builder.build(), HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() / 100 != 2) {
            throw new IllegalStateException("server returned HTTP " + response.statusCode() + ": "
                + AnthropicLlmClient.snippet(response.body()));
        }
        ObjectMapper mapper = new ObjectMapper();
        List<String> ids = new ArrayList<>();
        for (JsonNode m : mapper.readTree(response.body()).path("data")) {
            String id = m.path("id").asString("");
            if (!id.isBlank()) ids.add(id);
        }
        return ids;
    }

    @Override
    public Reply complete(String system, List<Msg> messages, List<ToolSpec> tools) throws IOException, InterruptedException {
        ObjectNode body = mapper.createObjectNode();
        body.put("model", model);
        ArrayNode wire = body.putArray("messages");
        wire.addObject().put("role", "system").put("content", system);
        for (Msg m : messages) {
            switch (m.role()) {
                case "user" -> wire.addObject().put("role", "user").put("content", m.text());
                case "assistant" -> {
                    ObjectNode msg = wire.addObject();
                    msg.put("role", "assistant");
                    if (m.text() == null || m.text().isEmpty()) {
                        msg.putNull("content");
                    } else {
                        msg.put("content", m.text());
                    }
                    if (!m.calls().isEmpty()) {
                        ArrayNode calls = msg.putArray("tool_calls");
                        for (ToolCall c : m.calls()) {
                            ObjectNode call = calls.addObject();
                            call.put("id", c.id());
                            call.put("type", "function");
                            call.putObject("function").put("name", c.name()).put("arguments", c.input().toString());
                        }
                    }
                }
                case "tool" -> wire.addObject().put("role", "tool").put("tool_call_id", m.toolCallId()).put("content", m.text());
                default -> throw new IllegalArgumentException("unknown role: " + m.role());
            }
        }
        if (!tools.isEmpty()) {
            ArrayNode wireTools = body.putArray("tools");
            for (ToolSpec t : tools) {
                ObjectNode fn = wireTools.addObject().put("type", "function").putObject("function");
                fn.put("name", t.name());
                fn.put("description", t.description());
                fn.set("parameters", t.inputSchema());
            }
        }
        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(baseUrl + "/chat/completions"))
            .timeout(Duration.ofMinutes(10))
            .header("content-type", "application/json");
        if (apiKey != null && !apiKey.isBlank()) {
            builder.header("authorization", "Bearer " + apiKey);
        }
        HttpResponse<String> response = http.send(
            builder.POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body))).build(),
            HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() / 100 != 2) {
            throw new IllegalStateException("LLM server returned HTTP " + response.statusCode() + ": "
                + AnthropicLlmClient.snippet(response.body()));
        }
        return parse(mapper.readTree(response.body()));
    }

    private Reply parse(JsonNode body) {
        JsonNode message = body.path("choices").path(0).path("message");
        String text = message.path("content").isNull() ? "" : message.path("content").asString("");
        List<ToolCall> calls = new ArrayList<>();
        for (JsonNode call : message.path("tool_calls")) {
            JsonNode fn = call.path("function");
            // Arguments come back as a JSON string. Parse it so the agent sees the same shape as Anthropic's input.
            JsonNode input = mapper.readTree(fn.path("arguments").asString("{}"));
            calls.add(new ToolCall(call.path("id").asString(), fn.path("name").asString(), input));
        }
        return new Reply(text, calls);
    }
}
