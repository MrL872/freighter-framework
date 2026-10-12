package com.example.application.workercontrollers.hydra;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

/**
 * Registers HydraRelayHandler at /ws/hydra for the live-terminal, accepting connections from any origin.
 *
 * The browser passes the job id as the jobId query parameter.
 */
@Configuration
@EnableWebSocket
public class HydraWebSocketConfig implements WebSocketConfigurer {
    private final HydraRelayHandler relayHandler;

    public HydraWebSocketConfig(HydraRelayHandler relayHandler) {
        this.relayHandler = relayHandler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(relayHandler, "/ws/hydra").setAllowedOriginPatterns("*");
    }
}
