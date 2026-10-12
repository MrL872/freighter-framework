package com.example.application.workercontrollers.dirsearch;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

/**
 * Registers DirsearchRelayHandler at /ws/dirsearch for the live-terminal, accepting connections from any
 * origin.
 *
 * The browser passes the job id as the jobId query parameter.
 */
@Configuration
@EnableWebSocket
public class DirsearchWebSocketConfig implements WebSocketConfigurer {
    private final DirsearchRelayHandler relayHandler;

    public DirsearchWebSocketConfig(DirsearchRelayHandler relayHandler) {
        this.relayHandler = relayHandler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(relayHandler, "/ws/dirsearch").setAllowedOriginPatterns("*");
    }
}
