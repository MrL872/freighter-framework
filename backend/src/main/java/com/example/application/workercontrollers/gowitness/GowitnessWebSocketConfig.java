package com.example.application.workercontrollers.gowitness;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

/**
 * Registers GowitnessRelayHandler at /ws/gowitness for the live-terminal, accepting connections from any
 * origin.
 *
 * The browser passes the job id as the jobId query parameter.
 */
@Configuration
@EnableWebSocket
public class GowitnessWebSocketConfig implements WebSocketConfigurer {
    private final GowitnessRelayHandler relayHandler;

    public GowitnessWebSocketConfig(GowitnessRelayHandler relayHandler) {
        this.relayHandler = relayHandler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(relayHandler, "/ws/gowitness").setAllowedOriginPatterns("*");
    }
}
