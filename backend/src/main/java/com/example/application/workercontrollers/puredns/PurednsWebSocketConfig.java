package com.example.application.workercontrollers.puredns;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

/**
 * Registers PurednsRelayHandler at /ws/puredns for the live terminal. The browser reaches it as /ws/puredns
 * through the frontend proxy, so the handler accepts any origin. The proxy forwards the frontend's own Origin
 * header, which Spring would otherwise reject.
 */
@Configuration
@EnableWebSocket
public class PurednsWebSocketConfig implements WebSocketConfigurer {
    private final PurednsRelayHandler relayHandler;

    public PurednsWebSocketConfig(PurednsRelayHandler relayHandler) {
        this.relayHandler = relayHandler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(relayHandler, "/ws/puredns").setAllowedOriginPatterns("*");
    }
}
