package com.example.application.chat;

import java.io.IOException;
import java.util.List;

import com.example.application.chat.LlmTypes.Msg;
import com.example.application.chat.LlmTypes.Reply;
import com.example.application.chat.LlmTypes.ToolSpec;

/**
 * One chat-completion call to a model. Implementations are bound to a single model.
 * AnthropicLlmClient and OpenAiCompatibleLlmClient implement it; ChatService calls it.
 */
public interface LlmClient {
    Reply complete(String system, List<Msg> messages, List<ToolSpec> tools) throws IOException, InterruptedException;
}
