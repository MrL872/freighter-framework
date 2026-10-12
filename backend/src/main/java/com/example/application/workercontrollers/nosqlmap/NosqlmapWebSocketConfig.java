package com.example.application.workercontrollers.nosqlmap;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

/**
 * Registers NosqlmapRelayHandler at the /ws/nosqlmap WebSocket endpoint so the live terminal can follow an
 * nosqlmap run.
 */
@Configuration
@EnableWebSocket
public class NosqlmapWebSocketConfig implements WebSocketConfigurer {
    private final NosqlmapRelayHandler relayHandler;

    public NosqlmapWebSocketConfig(NosqlmapRelayHandler relayHandler) {
        this.relayHandler = relayHandler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(relayHandler, "/ws/nosqlmap").setAllowedOriginPatterns("*");
    }
}
