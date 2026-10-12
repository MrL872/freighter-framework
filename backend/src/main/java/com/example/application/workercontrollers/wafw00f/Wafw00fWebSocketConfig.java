package com.example.application.workercontrollers.wafw00f;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

/**
 * Registers Wafw00fRelayHandler at /ws/wafw00f for the live terminal. The browser reaches it as /ws/wafw00f
 * through the frontend proxy, so the handler accepts any origin. The proxy forwards the frontend's own Origin
 * header, which Spring would otherwise reject.
 */
@Configuration
@EnableWebSocket
public class Wafw00fWebSocketConfig implements WebSocketConfigurer {
    private final Wafw00fRelayHandler relayHandler;

    public Wafw00fWebSocketConfig(Wafw00fRelayHandler relayHandler) {
        this.relayHandler = relayHandler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(relayHandler, "/ws/wafw00f").setAllowedOriginPatterns("*");
    }
}
