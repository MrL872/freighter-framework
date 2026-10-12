package com.example.application.persistence;

/**
 * Lifecycle values persisted for sessions and interpreted by SessionRepository and session workflows.
 */
public enum SessionStatus {
    ACTIVE, COMPLETED, FAILED
}