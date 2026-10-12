package com.example.application.persistence;

import java.time.LocalDateTime;

/**
 * Immutable representation of the output contract stored for a job.
 * ExpectedOutputRepository creates these records, and WorkerResultService passes them to WorkerResultValidator.
 */
public record ExpectedOutputRecord(Long id, Long jobId, String outputType, String definition,
                                   String requiredFields, String allowedStatus, long maxSize,
                                   LocalDateTime createdAt) {}