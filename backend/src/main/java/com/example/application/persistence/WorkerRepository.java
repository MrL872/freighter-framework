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
 * Provides JDBC persistence operations for disposable workers associated with jobs.
 * It records container identity and status in Derby, returning WorkerRecord values to WorkerService and result workflows.
 */
@Repository
public class WorkerRepository {
    private final JdbcTemplate jdbc;

    public WorkerRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public WorkerRecord register(long jobId, String workerType, String containerId) {
        LocalDateTime now = LocalDateTime.now();
        KeyHolder keys = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            PreparedStatement statement = connection.prepareStatement(
                "INSERT INTO workers(job_id, container_id, worker_type, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                Statement.RETURN_GENERATED_KEYS);
            statement.setLong(1, jobId);
            statement.setString(2, containerId);
            statement.setString(3, workerType);
            statement.setString(4, WorkerStatus.CREATED.name());
            statement.setTimestamp(5, Timestamp.valueOf(now));
            statement.setTimestamp(6, Timestamp.valueOf(now));
            return statement;
        }, keys);
        return findById(keys.getKey().longValue()).orElseThrow();
    }

    public Optional<WorkerRecord> findById(long id) {
        List<WorkerRecord> records = jdbc.query(
            "SELECT id, job_id, container_id, worker_type, status, created_at, updated_at FROM workers WHERE id = ?",
            (rs, row) -> new WorkerRecord(rs.getLong("id"), rs.getLong("job_id"), rs.getString("container_id"),
                rs.getString("worker_type"), WorkerStatus.valueOf(rs.getString("status")),
                rs.getTimestamp("created_at").toLocalDateTime(), rs.getTimestamp("updated_at").toLocalDateTime()), id);
        return records.stream().findFirst();
    }

    public int updateStatus(long id, WorkerStatus status) {
        return jdbc.update("UPDATE workers SET status = ?, updated_at = ? WHERE id = ?",
            status.name(), Timestamp.valueOf(LocalDateTime.now()), id);
    }
}