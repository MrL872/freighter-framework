package com.example.application;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.data.jdbc.autoconfigure.DataJdbcRepositoriesAutoConfiguration;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * Starts the Spring Boot application and its persistence, service, and web components.
 * Spring discovers the repositories, services, migration runner, and controller from this entry point.
 * Scheduling is enabled for IndexRetryScheduler (Elasticsearch indexing retry queue).
 */
@SpringBootApplication(exclude = DataJdbcRepositoriesAutoConfiguration.class)
@EnableScheduling
public class Application {

    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
