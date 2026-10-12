package com.example.application.chat;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import com.example.application.chat.LlmTypes.ToolSpec;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * Talks to the MCP gateway's JSON-RPC endpoint (POST /mcp). The gateway is
 * stateless, so no session handshake is needed. tools/call returns once the
 * worker run has finished, with the worker's result as JSON text. ChatService is
 * the only caller.
 */
@Component
public class McpGatewayClient {
    private static final Duration LIST_TIMEOUT = Duration.ofSeconds(15);
    /** Extra time on top of a call's own timeoutSeconds, for the gateway's round trip. */
    private static final Duration CALL_SLACK = Duration.ofSeconds(30);

    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private final ObjectMapper mapper = new ObjectMapper();
    private final AtomicLong ids = new AtomicLong(1);
    private final String baseUrl;

    public McpGatewayClient(@Value("${chat.mcp-gateway-url:http://mcp-gateway:8811}") String baseUrl) {
        this.baseUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
    }

    /** Every worker the gateway routes, as tools the model can call. */
    public List<ToolSpec> listTools() {
        JsonNode result = rpc("tools/list", mapper.createObjectNode(), LIST_TIMEOUT);
        List<ToolSpec> tools = new ArrayList<>();
        for (JsonNode t : result.path("tools")) {
            tools.add(new ToolSpec(t.path("name").asString(), t.path("description").asString(), t.path("inputSchema")));
        }
        return tools;
    }

    /**
     * Runs one worker tool and waits for it to finish. Returns the gateway's
     * JobResult: {worker, route, state, output, exitCode, error}.
     */
    public JsonNode callTool(String name, List<String> args, int timeoutSeconds) {
        ObjectNode params = mapper.createObjectNode();
        params.put("name", name);
        ObjectNode arguments = params.putObject("arguments");
        arguments.set("args", mapper.valueToTree(args));
        arguments.put("timeoutSeconds", timeoutSeconds);
        JsonNode result = rpc("tools/call", params, Duration.ofSeconds(timeoutSeconds).plus(CALL_SLACK));
        String text = result.path("content").path(0).path("text").asString("{}");
        try {
            return mapper.readTree(text);
        } catch (RuntimeException notJson) {
            // The gateway reports some failures as plain text, such as "unknown tool: x". Return them as a JobResult.
            ObjectNode error = mapper.createObjectNode();
            error.put("worker", name);
            error.put("state", "error");
            error.put("error", text);
            return error;
        }
    }

    private JsonNode rpc(String method, JsonNode params, Duration timeout) {
        ObjectNode request = mapper.createObjectNode();
        request.put("jsonrpc", "2.0");
        request.put("id", ids.getAndIncrement());
        request.put("method", method);
        request.set("params", params);
        try {
            HttpRequest httpRequest = HttpRequest.newBuilder(URI.create(baseUrl + "/mcp"))
                .timeout(timeout)
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(request)))
                .build();
            HttpResponse<String> response = http.send(httpRequest, HttpResponse.BodyHandlers.ofString());
            JsonNode body = mapper.readTree(response.body());
            if (body.has("error")) {
                throw new IllegalStateException("MCP gateway: " + body.path("error").path("message").asString());
            }
            return body.path("result");
        } catch (IOException e) {
            throw new IllegalStateException("MCP gateway is unreachable: " + e.getMessage(), e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("interrupted while calling the MCP gateway", e);
        }
    }
}
