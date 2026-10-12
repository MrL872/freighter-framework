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
 * Anthropic Messages API (POST {base}/v1/messages). ChatService creates one per
 * request. The API key stays on the server.
 */
public class AnthropicLlmClient implements LlmClient {
    private static final String VERSION = "2023-06-01";
    private static final int MAX_TOKENS = 4096;

    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    private final ObjectMapper mapper = new ObjectMapper();
    private final String baseUrl;
    private final String apiKey;
    private final String model;

    public AnthropicLlmClient(String baseUrl, String apiKey, String model) {
        this.baseUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
        this.apiKey = apiKey;
        this.model = model;
    }

    @Override
    public Reply complete(String system, List<Msg> messages, List<ToolSpec> tools) throws IOException, InterruptedException {
        ObjectNode body = mapper.createObjectNode();
        body.put("model", model);
        body.put("max_tokens", MAX_TOKENS);
        body.put("system", system);
        body.set("messages", toWire(messages));
        if (!tools.isEmpty()) {
            ArrayNode wireTools = body.putArray("tools");
            for (ToolSpec t : tools) {
                ObjectNode tool = wireTools.addObject();
                tool.put("name", t.name());
                tool.put("description", t.description());
                tool.set("input_schema", t.inputSchema());
            }
        }
        HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl + "/v1/messages"))
            .timeout(Duration.ofMinutes(5))
            .header("content-type", "application/json")
            .header("x-api-key", apiKey)
            .header("anthropic-version", VERSION)
            .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(body)))
            .build();
        HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() / 100 != 2) {
            throw new IllegalStateException("Anthropic API returned HTTP " + response.statusCode() + ": " + snippet(response.body()));
        }
        return parse(mapper.readTree(response.body()));
    }

    /** Converts neutral messages to Anthropic's shape. Consecutive tool results share one user message, as the API requires. */
    private ArrayNode toWire(List<Msg> messages) {
        ArrayNode out = mapper.createArrayNode();
        for (Msg m : messages) {
            switch (m.role()) {
                case "user" -> out.addObject().put("role", "user").put("content", m.text());
                case "assistant" -> {
                    ObjectNode msg = out.addObject();
                    msg.put("role", "assistant");
                    ArrayNode content = msg.putArray("content");
                    if (m.text() != null && !m.text().isEmpty()) {
                        content.addObject().put("type", "text").put("text", m.text());
                    }
                    for (ToolCall c : m.calls()) {
                        ObjectNode use = content.addObject();
                        use.put("type", "tool_use");
                        use.put("id", c.id());
                        use.put("name", c.name());
                        use.set("input", c.input());
                    }
                }
                case "tool" -> {
                    ObjectNode result = mapper.createObjectNode();
                    result.put("type", "tool_result");
                    result.put("tool_use_id", m.toolCallId());
                    result.put("content", m.text());
                    JsonNode last = out.isEmpty() ? null : out.get(out.size() - 1);
                    if (last != null && "user".equals(last.path("role").asString())
                            && last.path("content").isArray() && last.path("content").size() > 0
                            && "tool_result".equals(last.path("content").get(0).path("type").asString())) {
                        ((ArrayNode) last.path("content")).add(result);
                    } else {
                        out.addObject().put("role", "user").putArray("content").add(result);
                    }
                }
                default -> throw new IllegalArgumentException("unknown role: " + m.role());
            }
        }
        return out;
    }

    private static Reply parse(JsonNode body) {
        StringBuilder text = new StringBuilder();
        List<ToolCall> calls = new ArrayList<>();
        for (JsonNode block : body.path("content")) {
            switch (block.path("type").asString()) {
                case "text" -> text.append(block.path("text").asString());
                case "tool_use" -> calls.add(new ToolCall(block.path("id").asString(), block.path("name").asString(), block.path("input")));
                default -> { /* other block types are not shown */ }
            }
        }
        return new Reply(text.toString(), calls);
    }

    static String snippet(String s) {
        return s.length() > 300 ? s.substring(0, 300) + "..." : s;
    }
}
