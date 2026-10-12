package com.example.application.persistence;

import java.time.LocalDateTime;

/**
 * Immutable application view of a worker registered for a job.
 * WorkerRepository maps Derby rows to this record, while WorkerService uses it to enforce replacement rules.
 */
public record WorkerRecord(Long id, Long jobId, String containerId, String workerType, WorkerStatus status,
                           LocalDateTime createdAt, LocalDateTime updatedAt) {}