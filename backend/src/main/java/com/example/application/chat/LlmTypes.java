package com.example.application.chat;

import java.util.List;

import tools.jackson.databind.JsonNode;

/**
 * Provider-neutral shapes shared by the LLM clients and the agent loop in ChatService.
 * Each client converts these to its own wire format.
 */
public final class LlmTypes {
    private LlmTypes() {}

    /** A tool the model may call: a gateway worker and its JSON Schema for the input. */
    public record ToolSpec(String name, String description, JsonNode inputSchema) {}

    /** One tool call the model asked for. input is {"args": [...], "timeoutSeconds": N}. */
    public record ToolCall(String id, String name, JsonNode input) {}

    /**
     * One message in the conversation. role is "user", "assistant" or "tool".
     * An assistant message may carry tool calls; a tool message carries the
     * result text for the call whose id is toolCallId.
     */
    public record Msg(String role, String text, List<ToolCall> calls, String toolCallId) {}

    /** The model's answer: text, and any tool calls it wants run before it continues. */
    public record Reply(String text, List<ToolCall> calls) {}
}
