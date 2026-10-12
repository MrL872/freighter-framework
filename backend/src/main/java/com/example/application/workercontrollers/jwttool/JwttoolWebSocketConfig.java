package com.example.application.workercontrollers.jwttool;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

/**
 * Registers JwttoolRelayHandler at /ws/jwt-tool for the live-terminal, accepting connections from any origin.
 *
 * The browser passes the job id as the jobId query parameter.
 */
@Configuration
@EnableWebSocket
public class JwttoolWebSocketConfig implements WebSocketConfigurer {
    private final JwttoolRelayHandler relayHandler;

    public JwttoolWebSocketConfig(JwttoolRelayHandler relayHandler) {
        this.relayHandler = relayHandler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(relayHandler, "/ws/jwt-tool").setAllowedOriginPatterns("*");
    }
}
