package com.example.application.controller;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * Exposes the minimal application status endpoint for external health or smoke checks.
 * Spring MVC invokes this controller, while the application bootstrap supplies its web context.
 */
@RestController
public class ApplicationController {

    // The port this instance is actually listening on (SERVER_PORT in
    // docker-compose.yml, server.port in application.yml) -- surfaced so the
    // frontend's backend metric can show which port it's bound to.
    @Value("${server.port}")
    private String port;

    @GetMapping("/")
    public Map<String, String> index() {
        return Map.of(
            "application", "freighter-framework",
            "status", "running",
            "port", port
        );
    }
}
