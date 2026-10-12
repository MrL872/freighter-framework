package com.example.application.persistence;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.List;

/**
 * Durable retry queue backing ElasticsearchIndexer. Failed indexing operations
 * are stored here so they can be retried without losing the authoritative
 * application data. A row here never blocks or reverts the authoritative Derby
 * write in VulnerabilityRepository -- it only tracks that a follow-up push into
 * Elasticsearch is still owed. IndexRetryScheduler reads these rows to replay them.
 */
@Repository
public class IndexQueueRepository {
    private final JdbcTemplate jdbc;

    public IndexQueueRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public void enqueue(long vulnerabilityId, String error) {
        // Avoid piling up duplicate queue rows for the same vulnerability --
        // one outstanding retry entry per vulnerability is enough.
        boolean exists = jdbc.queryForObject(
            "SELECT COUNT(*) FROM index_queue WHERE vulnerability_id = ?", Integer.class, vulnerabilityId) > 0;
        if (exists) {
            jdbc.update("UPDATE index_queue SET last_error = ? WHERE vulnerability_id = ?", error, vulnerabilityId);
            return;
        }
        jdbc.update("INSERT INTO index_queue(vulnerability_id, attempts, last_error, created_at) VALUES (?, 0, ?, ?)",
            vulnerabilityId, error, Timestamp.valueOf(LocalDateTime.now()));
    }

    public List<IndexQueueRecord> pending(int limit) {
        return jdbc.query("SELECT * FROM index_queue ORDER BY created_at ASC FETCH FIRST ? ROWS ONLY",
            (rs, row) -> new IndexQueueRecord(rs.getLong("id"), rs.getLong("vulnerability_id"), rs.getInt("attempts"),
                rs.getString("last_error"), rs.getTimestamp("created_at").toLocalDateTime(),
                rs.getTimestamp("last_attempt_at") == null ? null : rs.getTimestamp("last_attempt_at").toLocalDateTime()),
            limit);
    }

    public void recordAttemptFailure(long id, String error) {
        jdbc.update("UPDATE index_queue SET attempts = attempts + 1, last_error = ?, last_attempt_at = ? WHERE id = ?",
            error, Timestamp.valueOf(LocalDateTime.now()), id);
    }

    public void remove(long id) {
        jdbc.update("DELETE FROM index_queue WHERE id = ?", id);
    }
}
