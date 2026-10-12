package com.example.application.workercontrollers.xsstrike;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

/**
 * Registers XsstrikeRelayHandler at /ws/xsstrike for the live terminal. The browser reaches it as /ws/xsstrike
 * through the frontend proxy, so the handler accepts any origin. The proxy forwards the frontend's own Origin
 * header, which Spring would otherwise reject.
 */
@Configuration
@EnableWebSocket
public class XsstrikeWebSocketConfig implements WebSocketConfigurer {
    private final XsstrikeRelayHandler relayHandler;

    public XsstrikeWebSocketConfig(XsstrikeRelayHandler relayHandler) {
        this.relayHandler = relayHandler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(relayHandler, "/ws/xsstrike").setAllowedOriginPatterns("*");
    }
}
