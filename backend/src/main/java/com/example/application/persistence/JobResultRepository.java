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

/**
 * Stores accepted worker results in Derby and returns their application representation.
 * WorkerResultService calls it only after ExpectedOutputRepository and WorkerResultValidator approve the output.
 */
@Repository
public class JobResultRepository {
    private final JdbcTemplate jdbc;

    public JobResultRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public JobResultRecord store(long jobId, Long workerId, String result, String status) {
        KeyHolder keys = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            PreparedStatement statement = connection.prepareStatement(
                "INSERT INTO job_results(job_id, worker_id, result, status, created_at) VALUES (?, ?, ?, ?, ?)",
                Statement.RETURN_GENERATED_KEYS);
            statement.setLong(1, jobId);
            if (workerId == null) statement.setNull(2, java.sql.Types.BIGINT);
            else statement.setLong(2, workerId);
            statement.setString(3, result);
            statement.setString(4, status);
            statement.setTimestamp(5, Timestamp.valueOf(LocalDateTime.now()));
            return statement;
        }, keys);
        return new JobResultRecord(keys.getKey().longValue(), jobId, workerId, result, status, LocalDateTime.now());
    }

    /** Results for every job tagged with the given frontend profile id (see JobRepository#create), oldest first. */
    public List<JobResultRecord> findByProfileId(String profileId) {
        return jdbc.query(
            "SELECT r.id, r.job_id, r.worker_id, r.result, r.status, r.created_at " +
            "FROM job_results r JOIN jobs j ON j.id = r.job_id " +
            "WHERE j.profile_id = ? ORDER BY r.created_at ASC",
            (rs, row) -> new JobResultRecord(rs.getLong("id"), rs.getLong("job_id"),
                rs.getObject("worker_id") == null ? null : rs.getLong("worker_id"), rs.getString("result"),
                rs.getString("status"), rs.getTimestamp("created_at").toLocalDateTime()), profileId);
    }
}