package com.example.application.persistence;

/**
 * Output formats that the application can expect and validate from workers.
 * ExpectedOutputRepository persists the selected value, and WorkerResultValidator compares worker output against it.
 */
public enum SupportedOutputType {
    JSON,
    TEXT
}