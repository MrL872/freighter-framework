package com.example.application.persistence;

/**
 * Lifecycle values persisted for jobs and interpreted by JobRepository and service-layer workflows.
 */
public enum JobStatus {
    QUEUED, STARTING, RUNNING, SUCCEEDED, FAILED, CANCELLING, CANCELLED,
    PENDING, COMPLETED
}