package com.example.application.service;

import com.example.application.persistence.WorkerRecord;
import com.example.application.persistence.WorkerRepository;
import com.example.application.persistence.WorkerStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Applies worker replacement rules when a worker has failed.
 * It reads and updates WorkerRepository records, marking the failed worker before registering its replacement.
 */
@Service
public class WorkerService {
    private final WorkerRepository workers;

    public WorkerService(WorkerRepository workers) {
        this.workers = workers;
    }

    @Transactional
    public WorkerRecord replaceWorker(long failedWorkerId, String workerType, String containerId) {
        WorkerRecord failed = workers.findById(failedWorkerId)
            .orElseThrow(() -> new IllegalArgumentException("Worker not found: " + failedWorkerId));
        if (failed.status() != WorkerStatus.FAILED) {
            throw new IllegalStateException("Only failed workers can be replaced");
        }
        if (workerType == null || workerType.isBlank() || containerId == null || containerId.isBlank()) {
            throw new IllegalArgumentException("Replacement worker identity is required");
        }
        workers.updateStatus(failedWorkerId, WorkerStatus.REPLACED);
        return workers.register(failed.jobId(), workerType, containerId);
    }
}