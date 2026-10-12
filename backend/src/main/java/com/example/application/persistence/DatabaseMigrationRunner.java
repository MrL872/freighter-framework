package com.example.application.persistence;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.Comparator;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Applies ordered SQL migrations when the Spring application starts.
 * It reads migration resources, records applied versions in Derby, and uses JdbcTemplate to execute database changes.
 */
@Component
public class DatabaseMigrationRunner implements ApplicationRunner {

    private static final Pattern FILE_PATTERN = Pattern.compile("V(\\d+)__([^.]*)\\.sql");

    private final JdbcTemplate jdbcTemplate;
    private final String migrationsLocation;

    public DatabaseMigrationRunner(
        JdbcTemplate jdbcTemplate,
        @Value("${freighter.database.migrations-location:classpath:db/migrations}") String migrationsLocation
    ) {
        this.jdbcTemplate = jdbcTemplate;
        this.migrationsLocation = migrationsLocation;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) throws Exception {
        ensureMigrationTable();
        Resource[] resources = resources();
        Arrays.sort(resources, Comparator.comparingInt(resource -> version(resource.getFilename())));

        for (Resource resource : resources) {
            int migrationVersion = version(resource.getFilename());
            if (jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM schema_migrations WHERE version = ?", Integer.class, migrationVersion) == 0) {
                for (String statement : resource.getContentAsString(StandardCharsets.UTF_8).split(";")) {
                    if (!statement.isBlank()) {
                        jdbcTemplate.execute(statement.trim());
                    }
                }
                jdbcTemplate.update(
                    "INSERT INTO schema_migrations(version, description, applied_at) VALUES (?, ?, ?)",
                    migrationVersion, resource.getFilename(), Timestamp.valueOf(LocalDateTime.now()));
            }
        }
    }

    private void ensureMigrationTable() {
        try {
            jdbcTemplate.queryForObject("SELECT COUNT(*) FROM schema_migrations", Integer.class);
        } catch (Exception ignored) {
            jdbcTemplate.execute("CREATE TABLE schema_migrations (version INTEGER NOT NULL PRIMARY KEY, description VARCHAR(255) NOT NULL, applied_at TIMESTAMP NOT NULL)");
            jdbcTemplate.update(
                "INSERT INTO schema_migrations(version, description, applied_at) VALUES (?, ?, ?)",
                1, "V001__initial.sql", Timestamp.valueOf(LocalDateTime.now()));
        }
    }

    private Resource[] resources() throws IOException {
        String pattern = migrationsLocation.startsWith("classpath:")
            ? migrationsLocation + "/V*.sql"
            : "classpath:" + migrationsLocation + "/V*.sql";
        return new PathMatchingResourcePatternResolver().getResources(pattern);
    }

    private int version(String filename) {
        Matcher matcher = FILE_PATTERN.matcher(filename);
        if (!matcher.matches()) {
            throw new IllegalArgumentException("Invalid migration filename: " + filename);
        }
        return Integer.parseInt(matcher.group(1));
    }
}