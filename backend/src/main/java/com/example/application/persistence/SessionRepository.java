package com.example.application.persistence;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

import java.sql.PreparedStatement;
import java.sql.Statement;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

/**
 * Provides JDBC persistence operations for application sessions.
 * It uses JdbcTemplate against Derby and returns SessionRecord values used by SessionService.
 */
@Repository
public class SessionRepository {
    private final JdbcTemplate jdbc;

    public SessionRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public SessionRecord create() {
        LocalDateTime now = LocalDateTime.now();
        KeyHolder keys = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            PreparedStatement statement = connection.prepareStatement(
                "INSERT INTO sessions(status, created_at, updated_at) VALUES (?, ?, ?)",
                Statement.RETURN_GENERATED_KEYS);
            statement.setString(1, SessionStatus.ACTIVE.name());
            statement.setTimestamp(2, Timestamp.valueOf(now));
            statement.setTimestamp(3, Timestamp.valueOf(now));
            return statement;
        }, keys);
        return findById(keys.getKey().longValue()).orElseThrow();
    }

    public Optional<SessionRecord> findById(long id) {
        List<SessionRecord> records = jdbc.query(
            "SELECT id, status, created_at, updated_at FROM sessions WHERE id = ?",
            (rs, row) -> new SessionRecord(rs.getLong("id"), SessionStatus.valueOf(rs.getString("status")),
                rs.getTimestamp("created_at").toLocalDateTime(), rs.getTimestamp("updated_at").toLocalDateTime()), id);
        return records.stream().findFirst();
    }

    public int updateStatus(long id, SessionStatus status) {
        return jdbc.update("UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?",
            status.name(), Timestamp.valueOf(LocalDateTime.now()), id);
    }
}