package com.example.application.persistence;

import java.time.LocalDateTime;

/**
 * Immutable application view of one persisted job and its lifecycle timestamps.
 * JobRepository maps Derby rows to this record, while SessionService and other services use it as the job boundary.
 */
public record JobRecord(Long id, Long sessionId, JobStatus status, LocalDateTime createdAt, LocalDateTime updatedAt,
                        String profileId) {}