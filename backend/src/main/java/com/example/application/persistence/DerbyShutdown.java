package com.example.application.persistence;

import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.sql.DriverManager;

/**
 * Requests a clean shutdown of the embedded Derby database during Spring destruction.
 * It receives the configured JDBC URL and signals Derby through DriverManager without affecting application state.
 */
@Component
public class DerbyShutdown {
    private final String databaseUrl;

    public DerbyShutdown(@Value("${spring.datasource.url}") String databaseUrl) {
        this.databaseUrl = databaseUrl;
    }

    @PreDestroy
    public void shutdown() {
        try {
            DriverManager.getConnection(databaseUrl + ";shutdown=true");
        } catch (Exception ignored) {
        }
    }
}