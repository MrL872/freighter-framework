-- Durable retry queue for the Elasticsearch indexer. The authoritative
-- vulnerability data is never lost while Elasticsearch is unavailable.
-- A row is enqueued whenever an index push to Elasticsearch fails, and
-- removed once IndexRetryScheduler successfully replays it.
CREATE TABLE index_queue (
    id BIGINT NOT NULL GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    vulnerability_id BIGINT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error VARCHAR(1024),
    created_at TIMESTAMP NOT NULL,
    last_attempt_at TIMESTAMP
);

CREATE INDEX index_queue_vuln_idx ON index_queue(vulnerability_id);
