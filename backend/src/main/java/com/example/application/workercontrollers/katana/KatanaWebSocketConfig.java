package com.example.application.workercontrollers.katana;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

/**
 * Registers KatanaRelayHandler at /ws/katana for the live-terminal, accepting connections from any origin.
 *
 * The browser passes the job id as the jobId query parameter.
 */
@Configuration
@EnableWebSocket
public class KatanaWebSocketConfig implements WebSocketConfigurer {
    private final KatanaRelayHandler relayHandler;

    public KatanaWebSocketConfig(KatanaRelayHandler relayHandler) {
        this.relayHandler = relayHandler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(relayHandler, "/ws/katana").setAllowedOriginPatterns("*");
    }
}
