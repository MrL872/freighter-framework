package com.example.application.chat;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import com.example.application.chat.LlmTypes.Msg;

import tools.jackson.databind.JsonNode;

/**
 * Chat endpoints: GET /chat/models, GET /chat/tools, POST /chat/message,
 * POST /chat/command and POST /chat/review. Delegates to ChatService. Provider
 * keys stay on the server, so the browser only sees provider and model names.
 */
@RestController
public class ChatController {

    public record HistoryItem(String role, String text) {}
    public record MessageRequest(String provider, String model, String mode, List<HistoryItem> messages) {}
    public record CommandRequest(String worker, List<String> args, Integer timeoutSeconds) {}
    public record ReviewRequest(String provider, String model, String worker, String result) {}

    private final ChatService chat;

    public ChatController(ChatService chat) {
        this.chat = chat;
    }

    /** Providers and models the server has keys or URLs for. */
    @GetMapping("/chat/models")
    public List<Map<String, String>> models() {
        return chat.models();
    }

    /** Worker tools the model can call through the gateway. */
    @GetMapping("/chat/tools")
    public ResponseEntity<?> tools() {
        return guarded(() -> {
            List<Map<String, String>> out = new ArrayList<>();
            chat.tools().forEach(t -> out.add(Map.of("name", t.name(), "description", t.description())));
            return out;
        });
    }

    /** One conversation turn. In agent mode the model may run tools; the reply lists every tool run. */
    @PostMapping("/chat/message")
    public ResponseEntity<?> message(@RequestBody MessageRequest request) {
        if (request.messages() == null || request.messages().isEmpty()
                || !"user".equals(request.messages().get(request.messages().size() - 1).role())) {
            return ResponseEntity.badRequest().body(Map.of("error", "messages must end with a user message"));
        }
        return guarded(() -> {
            List<Msg> history = new ArrayList<>();
            for (HistoryItem item : request.messages()) {
                String role = switch (item.role()) {
                    case "user" -> "user";
                    case "ai" -> "assistant";
                    default -> throw new IllegalArgumentException("role must be user or ai");
                };
                history.add(new Msg(role, item.text(), List.of(), null));
            }
            ChatService.AgentReply reply = chat.message(request.provider(), request.model(), request.mode(), history);
            List<Map<String, Object>> runs = new ArrayList<>();
            for (ChatService.ToolRun run : reply.toolRuns()) {
                runs.add(Map.of("worker", run.worker(), "args", run.args(), "result", run.result()));
            }
            return Map.of("text", reply.text(), "toolRuns", runs);
        });
    }

    /** Runs one worker directly, with no model: the "/worker args" path in the chat. */
    @PostMapping("/chat/command")
    public ResponseEntity<?> command(@RequestBody CommandRequest request) {
        if (request.worker() == null || request.worker().isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "worker is required"));
        }
        return guarded(() -> {
            JsonNode result = chat.command(request.worker(), request.args() == null ? List.of() : request.args(), request.timeoutSeconds());
            return result;
        });
    }

    /** Asks the model to review one tool result. */
    @PostMapping("/chat/review")
    public ResponseEntity<?> review(@RequestBody ReviewRequest request) {
        if (request.result() == null || request.result().isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "result is required"));
        }
        return guarded(() -> Map.of("text", chat.review(request.provider(), request.model(), request.worker(), request.result())));
    }

    @FunctionalInterface
    private interface Work {
        Object run() throws IOException, InterruptedException;
    }

    /** Maps failures to status codes: bad input 400; missing server config or an upstream failure 502. */
    private ResponseEntity<?> guarded(Work work) {
        try {
            return ResponseEntity.ok(work.run());
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(Map.of("error", e.getMessage()));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(Map.of("error", "interrupted"));
        } catch (IOException e) {
            return ResponseEntity.status(HttpStatus.BAD_GATEWAY).body(Map.of("error", "model request failed: " + e.getMessage()));
        }
    }
}
