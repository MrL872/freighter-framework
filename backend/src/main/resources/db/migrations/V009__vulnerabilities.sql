-- Vulnerability database: the application's own aggregated records, built from
-- worker findings rather than mirroring any external vulnerability database.
--
-- vuln_key is the deterministic dedup/identity key derived from
-- (worker, target, port, title) by VulnerabilityNormalizer. The same value
-- is used as the Elasticsearch document _id, so re-indexing updates rather
-- than duplicates.
CREATE TABLE vulnerabilities (
    id BIGINT NOT NULL GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    vuln_key VARCHAR(128) NOT NULL,
    worker VARCHAR(64) NOT NULL,
    target VARCHAR(512),
    port VARCHAR(16),
    title VARCHAR(512) NOT NULL,
    severity VARCHAR(32),
    description CLOB,
    remediation CLOB,
    status VARCHAR(32) NOT NULL DEFAULT 'OPEN',
    affected_version VARCHAR(128),
    occurrence_count INTEGER NOT NULL DEFAULT 1,
    first_seen_job_id BIGINT,
    last_seen_job_id BIGINT,
    profile_id VARCHAR(64),
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX vulnerabilities_key_idx ON vulnerabilities(vuln_key);
CREATE INDEX vulnerabilities_profile_idx ON vulnerabilities(profile_id);
CREATE INDEX vulnerabilities_severity_idx ON vulnerabilities(severity);
