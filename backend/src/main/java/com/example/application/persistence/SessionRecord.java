package com.example.application.persistence;

import java.time.LocalDateTime;

/**
 * Immutable application view of one persisted session and its lifecycle timestamps.
 * SessionRepository maps Derby rows to this record, and SessionService exposes it to higher layers.
 */
public record SessionRecord(Long id, SessionStatus status, LocalDateTime createdAt, LocalDateTime updatedAt) {}