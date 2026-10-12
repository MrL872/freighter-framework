package com.example.application.persistence;

import java.time.LocalDateTime;

/**
 * Immutable representation of a validated result stored for a job attempt.
 * JobResultRepository creates this record after WorkerResultService accepts output from a worker.
 */
public record JobResultRecord(Long id, Long jobId, Long workerId, String result, String status,
                              LocalDateTime createdAt) {}