package com.example.application.persistence;

import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;

/**
 * Validates untrusted worker output against the expected contract persisted for its job.
 * WorkerResultService invokes it before JobResultRepository is allowed to write a result to Derby.
 */
@Component
public class WorkerResultValidator {
    public void validate(ExpectedOutputRecord expected, SupportedOutputType outputType, String status, String result) {
        if (outputType == null) {
            throw new IllegalArgumentException("Worker result type is required");
        }
        if (result == null || result.getBytes(StandardCharsets.UTF_8).length > expected.maxSize()) {
            throw new IllegalArgumentException("Worker result exceeds the expected size");
        }
        if (!expected.outputType().equals(outputType.name()) || status == null || status.isBlank()) {
            throw new IllegalArgumentException("Worker result type is not expected");
        }
        if (expected.allowedStatus() != null && !expected.allowedStatus().equals(status)) {
            throw new IllegalArgumentException("Worker result status is not allowed");
        }
        if (expected.requiredFields() != null && !expected.requiredFields().isBlank()) {
            for (String field : Arrays.stream(expected.requiredFields().split(","))
                .map(String::trim).filter(value -> !value.isBlank()).toList()) {
                if (!result.contains(field)) {
                    throw new IllegalArgumentException("Worker result is missing required field: " + field);
                }
            }
        }
    }
}