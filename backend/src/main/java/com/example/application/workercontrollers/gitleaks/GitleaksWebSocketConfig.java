package com.example.application.workercontrollers.gitleaks;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

/**
 * Registers GitleaksRelayHandler at /ws/gitleaks for the live-terminal, accepting connections from any origin.
 *
 * The browser passes the job id as the jobId query parameter.
 */
@Configuration
@EnableWebSocket
public class GitleaksWebSocketConfig implements WebSocketConfigurer {
    private final GitleaksRelayHandler relayHandler;

    public GitleaksWebSocketConfig(GitleaksRelayHandler relayHandler) {
        this.relayHandler = relayHandler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(relayHandler, "/ws/gitleaks").setAllowedOriginPatterns("*");
    }
}
