package com.example.application.persistence;

import java.time.LocalDateTime;

/**
 * One report-style Description/Remediation template, keyed by (worker, title)
 * -- see V011__finding_templates.sql and FindingTemplateService, which looks
 * these up at read time (every /<tool>/findings call) rather than baking
 * rendered text into a finding when it's first ingested.
 *
 * title is null for a worker whose title is itself open-ended per finding
 * (nuclei's template name, gitleaks' rule id, wafw00f's WAF name) -- that
 * row is the wildcard FindingTemplateService falls back to when no exact
 * title match exists, and its templates reference {title} directly.
 */
public record FindingTemplateRecord(long id, String worker, String title, String descriptionTemplate,
                                     String remediationTemplate, LocalDateTime createdAt, LocalDateTime updatedAt) {
}
