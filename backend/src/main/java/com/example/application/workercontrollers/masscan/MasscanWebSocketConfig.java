package com.example.application.workercontrollers.masscan;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

/**
 * Registers MasscanRelayHandler at /ws/masscan for the live-terminal, accepting connections from any origin.
 * The browser passes the job id as the jobId query parameter.
 */
@Configuration
@EnableWebSocket
public class MasscanWebSocketConfig implements WebSocketConfigurer {
    private final MasscanRelayHandler relayHandler;

    public MasscanWebSocketConfig(MasscanRelayHandler relayHandler) {
        this.relayHandler = relayHandler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(relayHandler, "/ws/masscan").setAllowedOriginPatterns("*");
    }
}
