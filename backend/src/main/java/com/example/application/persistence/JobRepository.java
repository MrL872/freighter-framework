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
 * Provides JDBC persistence operations for jobs belonging to sessions.
 * It translates Derby rows into JobRecord values and is coordinated by SessionService and other application services.
 */
@Repository
public class JobRepository {
    private final JdbcTemplate jdbc;

    public JobRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public JobRecord create(long sessionId) {
        return create(sessionId, null);
    }

    /** profileId carries the frontend's (opaque, client-generated) company profile id, if the job was created on its behalf. */
    public JobRecord create(long sessionId, String profileId) {
        LocalDateTime now = LocalDateTime.now();
        KeyHolder keys = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            PreparedStatement statement = connection.prepareStatement(
                "INSERT INTO jobs(session_id, status, created_at, updated_at, profile_id) VALUES (?, ?, ?, ?, ?)",
                Statement.RETURN_GENERATED_KEYS);
            statement.setLong(1, sessionId);
            statement.setString(2, JobStatus.QUEUED.name());
            statement.setTimestamp(3, Timestamp.valueOf(now));
            statement.setTimestamp(4, Timestamp.valueOf(now));
            statement.setString(5, profileId);
            return statement;
        }, keys);
        return findById(keys.getKey().longValue()).orElseThrow();
    }

    public Optional<JobRecord> findById(long id) {
        List<JobRecord> records = jdbc.query(
            "SELECT id, session_id, status, created_at, updated_at, profile_id FROM jobs WHERE id = ?",
            (rs, row) -> new JobRecord(rs.getLong("id"), rs.getLong("session_id"), JobStatus.valueOf(rs.getString("status")),
                rs.getTimestamp("created_at").toLocalDateTime(), rs.getTimestamp("updated_at").toLocalDateTime(),
                rs.getString("profile_id")), id);
        return records.stream().findFirst();
    }

    public int updateStatus(long id, JobStatus status) {
        return jdbc.update("UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?",
            status.name(), Timestamp.valueOf(LocalDateTime.now()), id);
    }
}