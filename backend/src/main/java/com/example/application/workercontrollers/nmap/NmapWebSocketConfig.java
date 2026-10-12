package com.example.application.workercontrollers.nmap;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

/** Registers NmapRelayHandler at the /ws/nmap WebSocket endpoint so the live terminal can follow an nmap run. */
@Configuration
@EnableWebSocket
public class NmapWebSocketConfig implements WebSocketConfigurer {
    private final NmapRelayHandler relayHandler;

    public NmapWebSocketConfig(NmapRelayHandler relayHandler) {
        this.relayHandler = relayHandler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(relayHandler, "/ws/nmap").setAllowedOriginPatterns("*");
    }
}
