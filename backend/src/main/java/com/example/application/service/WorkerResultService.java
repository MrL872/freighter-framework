package com.example.application.service;

import com.example.application.persistence.ExpectedOutputRecord;
import com.example.application.persistence.ExpectedOutputRepository;
import com.example.application.persistence.JobResultRecord;
import com.example.application.persistence.JobResultRepository;
import com.example.application.persistence.SupportedOutputType;
import com.example.application.persistence.WorkerResultValidator;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Coordinates validation and persistence of output returned by a worker.
 * It loads the expected contract, delegates checks to WorkerResultValidator, and stores accepted results through JobResultRepository.
 */
@Service
public class WorkerResultService {
    private final ExpectedOutputRepository expectedOutputs;
    private final JobResultRepository results;
    private final WorkerResultValidator validator;
    private final VulnerabilityIngestService vulnerabilityIngest;

    public WorkerResultService(ExpectedOutputRepository expectedOutputs, JobResultRepository results,
                               WorkerResultValidator validator, VulnerabilityIngestService vulnerabilityIngest) {
        this.expectedOutputs = expectedOutputs;
        this.results = results;
        this.validator = validator;
        this.vulnerabilityIngest = vulnerabilityIngest;
    }

    @Transactional
    public JobResultRecord accept(long jobId, Long workerId, SupportedOutputType outputType, String status, String result) {
        ExpectedOutputRecord expected = expectedOutputs.findByJobId(jobId)
            .orElseThrow(() -> new IllegalArgumentException("No expected output for job: " + jobId));
        validator.validate(expected, outputType, status, result);
        JobResultRecord stored = results.store(jobId, workerId, result, status);
        // Feeds the vulnerability database and the Elasticsearch
        // indexer from the same accepted-result path every
        // worker already goes through. Best-effort and additive: it never
        // throws back into this method, so a vulnerability-processing
        // problem can never block or roll back the raw result write above.
        vulnerabilityIngest.ingest(jobId, result);
        return stored;
    }
}