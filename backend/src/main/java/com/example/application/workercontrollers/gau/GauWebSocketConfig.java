package com.example.application.workercontrollers.gau;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

/** Registers GauRelayHandler at the /ws/gau WebSocket endpoint so the live terminal can follow a gau run. */
@Configuration
@EnableWebSocket
public class GauWebSocketConfig implements WebSocketConfigurer {
    private final GauRelayHandler relayHandler;

    public GauWebSocketConfig(GauRelayHandler relayHandler) {
        this.relayHandler = relayHandler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(relayHandler, "/ws/gau").setAllowedOriginPatterns("*");
    }
}
