package com.example.application.workercontrollers.nuclei;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

/**
 * Registers NucleiRelayHandler at /ws/nuclei for the live terminal. The browser reaches it as /ws/nuclei
 * through the frontend proxy, so the handler accepts any origin. The proxy forwards the frontend's own Origin
 * header, which Spring would otherwise reject.
 */
@Configuration
@EnableWebSocket
public class NucleiWebSocketConfig implements WebSocketConfigurer {
    private final NucleiRelayHandler relayHandler;

    public NucleiWebSocketConfig(NucleiRelayHandler relayHandler) {
        this.relayHandler = relayHandler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(relayHandler, "/ws/nuclei").setAllowedOriginPatterns("*");
    }
}
