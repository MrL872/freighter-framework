package com.example.application.workercontrollers.metasploit;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

/**
 * Registers MetasploitRelayHandler at /ws/metasploit for the live-terminal, accepting connections from any
 * origin. The browser passes the job id as the jobId query parameter.
 */
@Configuration
@EnableWebSocket
public class MetasploitWebSocketConfig implements WebSocketConfigurer {
    private final MetasploitRelayHandler relayHandler;

    public MetasploitWebSocketConfig(MetasploitRelayHandler relayHandler) {
        this.relayHandler = relayHandler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(relayHandler, "/ws/metasploit").setAllowedOriginPatterns("*");
    }
}
