package com.example.application.workercontrollers.fuxploider;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

/**
 * Registers FuxploiderRelayHandler at /ws/fuxploider for the live-terminal, accepting connections from any
 * origin.
 *
 * The browser passes the job id as the jobId query parameter.
 */
@Configuration
@EnableWebSocket
public class FuxploiderWebSocketConfig implements WebSocketConfigurer {
    private final FuxploiderRelayHandler relayHandler;

    public FuxploiderWebSocketConfig(FuxploiderRelayHandler relayHandler) {
        this.relayHandler = relayHandler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(relayHandler, "/ws/fuxploider").setAllowedOriginPatterns("*");
    }
}
