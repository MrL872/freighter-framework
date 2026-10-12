package com.example.application.service;

import com.example.application.persistence.IndexQueueRecord;
import com.example.application.persistence.IndexQueueRepository;
import com.example.application.persistence.VulnerabilityRecord;
import com.example.application.persistence.VulnerabilityRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Periodically replays ElasticsearchIndexer's durable retry queue, reading it
 * through IndexQueueRepository. Runs independently of the worker-result path so a prolonged Elasticsearch
 * outage degrades search freshness only, never the authoritative database.
 */
@Component
public class IndexRetryScheduler {
    private static final Logger log = LoggerFactory.getLogger(IndexRetryScheduler.class);
    private static final int MAX_ATTEMPTS = 10;
    private static final int BATCH_SIZE = 25;

    private final IndexQueueRepository queue;
    private final VulnerabilityRepository vulnerabilities;
    private final ElasticsearchIndexer indexer;

    public IndexRetryScheduler(IndexQueueRepository queue, VulnerabilityRepository vulnerabilities,
                                ElasticsearchIndexer indexer) {
        this.queue = queue;
        this.vulnerabilities = vulnerabilities;
        this.indexer = indexer;
    }

    // initialDelay keeps the first run from starting before the migrations
    // have created the index_queue table (see DatabaseMigrationRunner).
    @Scheduled(initialDelayString = "${elasticsearch.retry.interval-ms:30000}",
               fixedDelayString = "${elasticsearch.retry.interval-ms:30000}")
    public void retryPending() {
        for (IndexQueueRecord queued : queue.pending(BATCH_SIZE)) {
            try {
                VulnerabilityRecord record = vulnerabilities.findById(queued.vulnerabilityId()).orElse(null);
                if (record == null || record.deletedAt() != null) {
                    // The vulnerability row is gone, or was deleted since this was
                    // queued -- either way, nothing should be (re-)indexed for it.
                    queue.remove(queued.id());
                    continue;
                }
                indexer.indexNow(record);
                queue.remove(queued.id());
                log.info("elasticsearch-indexing-retry-succeeded vuln_id={}", queued.vulnerabilityId());
            } catch (Exception e) {
                queue.recordAttemptFailure(queued.id(), e.getMessage());
                log.warn("elasticsearch-indexing-retry-failed vuln_id={} attempts={} message={}",
                    queued.vulnerabilityId(), queued.attempts() + 1, e.getMessage());
                if (queued.attempts() + 1 >= MAX_ATTEMPTS) {
                    // TODO: surface permanently-failed indexing operations via an
                    // operator-facing alert/metric rather than just a log line.
                    log.error("elasticsearch-indexing-retry-exhausted vuln_id={}", queued.vulnerabilityId());
                }
            }
        }
    }
}
