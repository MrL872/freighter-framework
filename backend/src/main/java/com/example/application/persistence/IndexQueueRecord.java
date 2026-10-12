package com.example.application.persistence;

import java.time.LocalDateTime;

/**
 * One pending (failed) Elasticsearch indexing operation awaiting retry.
 * IndexQueueRepository maps rows to this record, and IndexRetryScheduler replays it.
 */
public record IndexQueueRecord(Long id, Long vulnerabilityId, int attempts, String lastError,
                                LocalDateTime createdAt, LocalDateTime lastAttemptAt) {}
