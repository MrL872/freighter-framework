package com.example.application.workercontrollers.sstimap;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

/**
 * Registers SstimapRelayHandler at /ws/sstimap for the live terminal. The browser reaches it as /ws/sstimap
 * through the frontend proxy, so the handler accepts any origin. The proxy forwards the frontend's own Origin
 * header, which Spring would otherwise reject.
 */
@Configuration
@EnableWebSocket
public class SstimapWebSocketConfig implements WebSocketConfigurer {
    private final SstimapRelayHandler relayHandler;

    public SstimapWebSocketConfig(SstimapRelayHandler relayHandler) {
        this.relayHandler = relayHandler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(relayHandler, "/ws/sstimap").setAllowedOriginPatterns("*");
    }
}
