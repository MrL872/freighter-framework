package com.example.application.persistence;

/**
 * Lifecycle values persisted for workers and interpreted by WorkerRepository and WorkerService.
 */
public enum WorkerStatus {
    CREATED, STARTING, RUNNING, COMPLETED, FAILED, CANCELLED, REPLACED
}