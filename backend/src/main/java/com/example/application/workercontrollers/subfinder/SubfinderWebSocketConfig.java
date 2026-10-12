package com.example.application.workercontrollers.subfinder;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

/**
 * Registers SubfinderRelayHandler at /ws/subfinder for the live terminal. The browser reaches it as
 * /ws/subfinder through the frontend proxy in frontend/server.js. The proxy forwards the frontend's
 * Origin header, not this backend's, which Spring's WebSocket support would reject by default. So all
 * origins are allowed.
 */
@Configuration
@EnableWebSocket
public class SubfinderWebSocketConfig implements WebSocketConfigurer {
    private final SubfinderRelayHandler relayHandler;

    public SubfinderWebSocketConfig(SubfinderRelayHandler relayHandler) {
        this.relayHandler = relayHandler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(relayHandler, "/ws/subfinder").setAllowedOriginPatterns("*");
    }
}
