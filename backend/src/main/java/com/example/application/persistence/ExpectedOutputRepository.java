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
 * Persists and retrieves the expected output contract associated with a job.
 * It uses JdbcTemplate against Derby and returns ExpectedOutputRecord values consumed by WorkerResultService.
 */
@Repository
public class ExpectedOutputRepository {
    private final JdbcTemplate jdbc;

    public ExpectedOutputRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public ExpectedOutputRecord store(long jobId, SupportedOutputType outputType, String definition,
                                      String requiredFields, String allowedStatus, long maxSize) {
        if (outputType == null || definition == null || definition.isBlank() || maxSize <= 0 || maxSize > 10485760) {
            throw new IllegalArgumentException("Expected output definition is invalid");
        }
        KeyHolder keys = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            PreparedStatement statement = connection.prepareStatement(
                "INSERT INTO expected_outputs(job_id, output_type, definition, required_fields, allowed_status, max_size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                Statement.RETURN_GENERATED_KEYS);
            statement.setLong(1, jobId);
            statement.setString(2, outputType.name());
            statement.setString(3, definition);
            statement.setString(4, requiredFields);
            statement.setString(5, allowedStatus);
            statement.setLong(6, maxSize);
            statement.setTimestamp(7, Timestamp.valueOf(LocalDateTime.now()));
            return statement;
        }, keys);
        return findByJobId(jobId).orElseThrow();
    }

    public Optional<ExpectedOutputRecord> findByJobId(long jobId) {
        List<ExpectedOutputRecord> records = jdbc.query(
            "SELECT id, job_id, output_type, definition, required_fields, allowed_status, max_size, created_at FROM expected_outputs WHERE job_id = ?",
            (rs, row) -> new ExpectedOutputRecord(rs.getLong("id"), rs.getLong("job_id"), rs.getString("output_type"),
                rs.getString("definition"), rs.getString("required_fields"), rs.getString("allowed_status"),
                rs.getLong("max_size"), rs.getTimestamp("created_at").toLocalDateTime()), jobId);
        return records.stream().findFirst();
    }
}