package com.example.application.chat;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import com.example.application.chat.LlmTypes.Msg;
import com.example.application.chat.LlmTypes.Reply;
import com.example.application.chat.LlmTypes.ToolCall;
import com.example.application.chat.LlmTypes.ToolSpec;
import com.example.application.settings.LlmSettingsStore;
import com.example.application.settings.LocalLlmSettingsStore;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * Chat orchestration, called by ChatController. It builds an LlmClient for the
 * requested provider and reaches worker tools through McpGatewayClient. Three paths:
 * - message(): a conversation with the model. In "agent" mode the model may call
 *   worker tools through the MCP gateway, and each result goes back to the model.
 * - command(): a worker tool run directly, with no model involved.
 * - review(): the model reads one tool result and summarizes it.
 */
@Service
public class ChatService {
    /** Most tool rounds the model may take in one message before the loop stops. */
    static final int MAX_STEPS = 8;
    /** Timeout used when the model does not give one. */
    static final int DEFAULT_TIMEOUT_SECONDS = 300;
    /** Largest tool output sent back to the model. The newest text is kept. */
    static final int MAX_MODEL_OUTPUT = 32 * 1024;

    private static final String BASE = "You are the assistant inside freighter-framework, a tool for authorized security testing. "
        + "Worker tools run real security tools in isolated containers. Act only on targets the user names and is authorized to test. "
        + "Be factual. Quote the output lines that support each claim.";
    private static final String AGENT = BASE + " You may call worker tools through the gateway. A tool takes args, "
        + "the command-line arguments as strings, and optional timeoutSeconds. Results contain state, output and exitCode.";
    private static final String PLAN = BASE + " Do not call tools. Propose a numbered plan of the commands to run and why.";
    private static final String ASK = BASE + " Answer from the conversation. Do not call tools.";
    private static final String REVIEW = "You review the output of one security tool run. Summarize what it found, "
        + "say what is uncertain, and list concrete next steps. Do not report anything that is not in the output.";

    public record ToolRun(String worker, List<String> args, JsonNode result) {}
    public record AgentReply(String text, List<ToolRun> toolRuns) {}

    private final McpGatewayClient gateway;
    private final LlmSettingsStore llmSettings;
    private final LocalLlmSettingsStore localLlmSettings;
    private final String anthropicBaseUrl;
    private final String anthropicModel;

    public ChatService(McpGatewayClient gateway,
                       LlmSettingsStore llmSettings,
                       LocalLlmSettingsStore localLlmSettings,
                       @Value("${chat.anthropic.base-url:https://api.anthropic.com}") String anthropicBaseUrl,
                       @Value("${chat.anthropic.model:claude-sonnet-5}") String anthropicModel) {
        this.gateway = gateway;
        this.llmSettings = llmSettings;
        this.localLlmSettings = localLlmSettings;
        this.anthropicBaseUrl = anthropicBaseUrl;
        this.anthropicModel = anthropicModel;
    }

    /** Models the server is configured for right now. Keys are never returned. */
    public List<Map<String, String>> models() {
        List<Map<String, String>> out = new ArrayList<>();
        if (!llmSettings.effectiveApiKey().isBlank()) out.add(Map.of("provider", "anthropic", "model", anthropicModel));
        LocalLlmSettingsStore.Effective local = localLlmSettings.effective();
        if (local.enabled() && local.configured()) out.add(Map.of("provider", "openai-compatible", "model", local.model()));
        return out;
    }

    public List<ToolSpec> tools() {
        return gateway.listTools();
    }

    /** Runs a conversation. history ends with the new user message. */
    public AgentReply message(String provider, String model, String mode, List<Msg> history) throws IOException, InterruptedException {
        LlmClient llm = clientFor(provider, model);
        boolean useTools = "agent".equals(mode);
        String system = switch (mode == null ? "ask" : mode) {
            case "agent" -> AGENT;
            case "plan" -> PLAN;
            case "ask" -> ASK;
            default -> throw new IllegalArgumentException("mode must be ask, agent or plan");
        };
        List<ToolSpec> tools = useTools ? gateway.listTools() : List.of();
        List<Msg> conversation = new ArrayList<>(history);
        List<ToolRun> runs = new ArrayList<>();

        Reply reply = llm.complete(system, conversation, tools);
        for (int step = 0; !reply.calls().isEmpty() && step < MAX_STEPS; step++) {
            conversation.add(new Msg("assistant", reply.text(), reply.calls(), null));
            for (ToolCall call : reply.calls()) {
                List<String> args = argsOf(call.input());
                int timeout = call.input().path("timeoutSeconds").asInt(DEFAULT_TIMEOUT_SECONDS);
                JsonNode result = gateway.callTool(call.name(), args, timeout);
                runs.add(new ToolRun(call.name(), args, result));
                conversation.add(new Msg("tool", forModel(result).toString(), List.of(), call.id()));
            }
            reply = llm.complete(system, conversation, tools);
        }
        return new AgentReply(reply.text(), runs);
    }

    /** Runs one worker tool with no model involved. */
    public JsonNode command(String worker, List<String> args, Integer timeoutSeconds) {
        int timeout = timeoutSeconds == null ? DEFAULT_TIMEOUT_SECONDS : timeoutSeconds;
        return gateway.callTool(worker, args, timeout);
    }

    /** Asks the model to summarize one tool result. */
    public String review(String provider, String model, String worker, String resultJson) throws IOException, InterruptedException {
        LlmClient llm = clientFor(provider, model);
        Msg prompt = new Msg("user", "Tool: " + worker + "\nResult:\n" + truncate(resultJson), List.of(), null);
        return llm.complete(REVIEW, List.of(prompt), List.of()).text();
    }

    private LlmClient clientFor(String provider, String model) {
        if (provider == null) throw new IllegalArgumentException("provider is required");
        return switch (provider) {
            case "anthropic" -> {
                String key = llmSettings.effectiveApiKey();
                if (key.isBlank()) throw new IllegalStateException("the cloud model is turned off or has no API key set in Settings");
                yield new AnthropicLlmClient(anthropicBaseUrl, key, model == null || model.isBlank() ? anthropicModel : model);
            }
            case "openai-compatible" -> {
                LocalLlmSettingsStore.Effective local = localLlmSettings.effective();
                if (!local.enabled() || !local.configured()) {
                    throw new IllegalStateException("the local model is turned off or has no base URL/model set in Settings");
                }
                yield new OpenAiCompatibleLlmClient(local.baseUrl(), local.apiKey(), model == null || model.isBlank() ? local.model() : model);
            }
            default -> throw new IllegalArgumentException("unknown provider: " + provider);
        };
    }

    private static List<String> argsOf(JsonNode input) {
        List<String> args = new ArrayList<>();
        for (JsonNode a : input.path("args")) args.add(a.asString());
        return args;
    }

    /** The result as the model sees it: same fields, with output cut to MAX_MODEL_OUTPUT. */
    private JsonNode forModel(JsonNode result) {
        if (!(result instanceof ObjectNode obj) || result.path("output").asString("").length() <= MAX_MODEL_OUTPUT) {
            return result;
        }
        ObjectNode copy = obj.deepCopy();
        copy.put("output", truncate(result.path("output").asString("")));
        return copy;
    }

    private static String truncate(String s) {
        return s.length() <= MAX_MODEL_OUTPUT ? s : "[truncated to the last 32 KB]\n" + s.substring(s.length() - MAX_MODEL_OUTPUT);
    }
}
