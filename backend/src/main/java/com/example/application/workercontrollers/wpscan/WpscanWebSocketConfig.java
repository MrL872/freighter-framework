package com.example.application.workercontrollers.wpscan;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

/**
 * Registers WpscanRelayHandler at /ws/wpscan for the live terminal. The browser reaches it as /ws/wpscan
 * through the frontend proxy, so the handler accepts any origin. The proxy forwards the frontend's own Origin
 * header, which Spring would otherwise reject.
 */
@Configuration
@EnableWebSocket
public class WpscanWebSocketConfig implements WebSocketConfigurer {
    private final WpscanRelayHandler relayHandler;

    public WpscanWebSocketConfig(WpscanRelayHandler relayHandler) {
        this.relayHandler = relayHandler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(relayHandler, "/ws/wpscan").setAllowedOriginPatterns("*");
    }
}
