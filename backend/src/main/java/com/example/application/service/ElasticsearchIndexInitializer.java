package com.example.application.service;

import com.example.application.persistence.VulnerabilityRecord;
import com.example.application.persistence.VulnerabilityRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;

/**
 * Creates the Elasticsearch index and its mapping. The main application owns
 * the index lifecycle, not Elasticsearch, because the index is a derived search
 * index rather than the authoritative store.
 *
 * Startup is best-effort: the application starts even if Elasticsearch is down.
 * Until the index exists, search returns no results, so this class keeps
 * retrying in the background (see retryUntilReady) and stops once the index is
 * in place. Without that retry, an index that failed to be created at startup
 * would stay missing until the backend was restarted. IndexRetryScheduler
 * backfills anything queued while Elasticsearch was unreachable.
 */
@Component
@Order(100)
public class ElasticsearchIndexInitializer implements ApplicationRunner {
    private static final Logger log = LoggerFactory.getLogger(ElasticsearchIndexInitializer.class);

    // lowercase_normalizer makes term-level filters on target.keyword,
    // affectedVersion.keyword and worker.keyword case-insensitive: ES applies
    // a normalizer to both the indexed value and a term/terms query's value,
    // unlike an analyzer (which only applies at index time). worker moved
    // from a bare keyword to text+keyword so it's tokenized and searchable
    // (case-insensitively, via the standard analyzer's own lowercasing) from
    // the free-text search bar -- see ElasticsearchQueryService's multi_match.
    private static final String MAPPING = """
        {
          "settings": {
            "analysis": {
              "normalizer": {
                "lowercase_normalizer": { "type": "custom", "filter": ["lowercase"] }
              }
            }
          },
          "mappings": {
            "properties": {
              "vulnKey": { "type": "keyword" },
              "worker": { "type": "text", "fields": { "keyword": { "type": "keyword", "normalizer": "lowercase_normalizer" } } },
              "target": { "type": "text", "fields": { "keyword": { "type": "keyword", "normalizer": "lowercase_normalizer" } } },
              "port": { "type": "keyword" },
              "path": { "type": "text", "fields": { "keyword": { "type": "keyword" } } },
              "statusCode": { "type": "integer" },
              "title": { "type": "text" },
              "severity": { "type": "keyword" },
              "description": { "type": "text" },
              "remediation": { "type": "text" },
              "status": { "type": "keyword" },
              "affectedVersion": { "type": "text", "fields": { "keyword": { "type": "keyword", "normalizer": "lowercase_normalizer" } } },
              "occurrenceCount": { "type": "integer" },
              "profileId": { "type": "keyword" },
              "vulnerabilityId": { "type": "long" },
              "createdAt": { "type": "date" },
              "updatedAt": { "type": "date" }
            }
          }
        }
        """;

    private final String baseUrl;
    private final HttpClient http;
    private final VulnerabilityRepository vulnerabilities;
    private final ElasticsearchIndexer indexer;
    private final Executor reindexExecutor = Executors.newVirtualThreadPerTaskExecutor();
    private volatile boolean ready;

    public ElasticsearchIndexInitializer(@Value("${elasticsearch.url:http://elasticsearch:9200}") String baseUrl,
                                          VulnerabilityRepository vulnerabilities, ElasticsearchIndexer indexer) {
        this.baseUrl = baseUrl;
        this.vulnerabilities = vulnerabilities;
        this.indexer = indexer;
        this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    }

    @Override
    public void run(ApplicationArguments args) {
        ensureIndex();
    }

    /**
     * Retries index creation every 30 seconds until it succeeds. Once the index
     * exists, this does nothing.
     */
    @Scheduled(fixedDelay = 30_000, initialDelay = 30_000)
    public void retryUntilReady() {
        if (!ready) {
            ensureIndex();
        }
    }

    /**
     * Makes sure the index exists with its mapping. Returns true if it does.
     * An index that already exists counts as success, including when another
     * request created it at the same moment.
     */
    boolean ensureIndex() {
        if (ready) {
            return true;
        }
        try {
            HttpRequest head = HttpRequest.newBuilder()
                .uri(URI.create(baseUrl + "/" + ElasticsearchIndexer.INDEX_NAME))
                .method("HEAD", HttpRequest.BodyPublishers.noBody())
                .timeout(Duration.ofSeconds(5))
                .build();
            HttpResponse<Void> existing = http.send(head, HttpResponse.BodyHandlers.discarding());
            if (existing.statusCode() == 200) {
                markReady("elasticsearch-index-ready");
                return true;
            }
            HttpRequest create = HttpRequest.newBuilder()
                .uri(URI.create(baseUrl + "/" + ElasticsearchIndexer.INDEX_NAME))
                .header("Content-Type", "application/json")
                .timeout(Duration.ofSeconds(10))
                .PUT(HttpRequest.BodyPublishers.ofString(MAPPING))
                .build();
            HttpResponse<String> response = http.send(create, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 300) {
                markReady("elasticsearch-index-created");
                // A brand-new index is empty, unlike Derby (the authoritative
                // store), which already holds every vulnerability ever
                // ingested -- backfill it now so existing records are
                // searchable immediately instead of only after their next
                // upsert. Only reached when this call actually created the
                // index (not the race-losing "already exists" branch below),
                // so it can't double-reindex against a concurrent creator.
                reindexAll();
                return true;
            }
            if (response.body().contains("resource_already_exists_exception")) {
                markReady("elasticsearch-index-created");
                return true;
            }
            log.warn("elasticsearch-index-create-failed status={} body={}", response.statusCode(), response.body());
        } catch (Exception e) {
            log.warn("elasticsearch-index-unavailable message={}", e.getMessage());
        }
        return false;
    }

    /**
     * Backfills a freshly created index from Derby, the authoritative store.
     * Runs on a background thread so a large vulnerability table can't delay
     * application startup, and tolerates per-record failures the same way
     * ElasticsearchIndexer.indexAsync() does -- IndexRetryScheduler has no
     * visibility into this pass, so a record that fails here simply stays
     * missing from search until it's next upserted, rather than retrying.
     */
    private void reindexAll() {
        CompletableFuture.runAsync(() -> {
            List<VulnerabilityRecord> records = vulnerabilities.findAllActive();
            int failed = 0;
            for (VulnerabilityRecord record : records) {
                try {
                    indexer.indexNow(record);
                } catch (Exception e) {
                    failed++;
                    log.warn("elasticsearch-reindex-record-failed vuln_id={} message={}", record.id(), e.getMessage());
                }
            }
            log.info("elasticsearch-reindex-complete total={} failed={}", records.size(), failed);
        }, reindexExecutor);
    }

    private void markReady(String event) {
        ready = true;
        log.info("{} index={}", event, ElasticsearchIndexer.INDEX_NAME);
    }
}
