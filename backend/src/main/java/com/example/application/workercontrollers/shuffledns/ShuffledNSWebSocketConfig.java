package com.example.application.workercontrollers.shuffledns;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

/**
 * Registers ShuffledNSRelayHandler at /ws/shuffledns for the live terminal. The browser reaches it as
 * /ws/shuffledns through the frontend proxy, so the handler accepts any origin. The proxy forwards the
 * frontend's own Origin header, which Spring would otherwise reject.
 */
@Configuration
@EnableWebSocket
public class ShuffledNSWebSocketConfig implements WebSocketConfigurer {
    private final ShuffledNSRelayHandler relayHandler;

    public ShuffledNSWebSocketConfig(ShuffledNSRelayHandler relayHandler) {
        this.relayHandler = relayHandler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(relayHandler, "/ws/shuffledns").setAllowedOriginPatterns("*");
    }
}
