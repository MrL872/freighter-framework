package com.example.application.service;

import com.example.application.persistence.IndexQueueRepository;
import com.example.application.persistence.VulnerabilityRecord;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;

/**
 * Pushes authoritative vulnerability records into Elasticsearch. Called by
 * VulnerabilityIngestService after a record is persisted to Derby, and by
 * IndexRetryScheduler when it replays queued operations.
 *
 * Deliberately talks to Elasticsearch's plain REST API over java.net.http
 * instead of pulling in the official Elasticsearch Java client: that client
 * (and its transitive Jackson/Log4j stack) tracks its own release train and
 * has been known to bind tightly to one Jackson major version, which
 * risks colliding with Spring Boot 4.1.1's own (Jackson 3 / "tools.jackson")
 * dependency management. A raw HTTP client avoids that version coupling
 * entirely and is more than sufficient for the handful of operations this
 * component needs (index-by-id, search).
 *
 * Reliability: indexAsync() tolerates temporary Elasticsearch failures. It never throws back into the caller
 * (VulnerabilityIngestService, itself called from the worker-result path)
 * and never blocks it -- the HTTP call happens on a background executor,
 * and on failure the vulnerability id is written to IndexQueueRepository's
 * durable retry queue instead of being retried inline. IndexRetryScheduler
 * replays that queue later. The authoritative Derby write has already
 * committed by the time this runs, so Elasticsearch downtime cannot lose or
 * block authoritative data.
 */
@Component
public class ElasticsearchIndexer {
    private static final Logger log = LoggerFactory.getLogger(ElasticsearchIndexer.class);
    // v2: worker became a text+keyword field and the keyword subfields used
    // for exact filtering (target.keyword, affectedVersion.keyword,
    // worker.keyword) picked up a lowercase normalizer -- see
    // ElasticsearchIndexInitializer. Both are mapping changes Elasticsearch
    // can't apply to an existing index, so the name changed to force a fresh
    // index/full reindex instead of silently keeping the old mapping.
    public static final String INDEX_NAME = "vulnerabilities_v2";

    private final String baseUrl;
    private final HttpClient http;
    private final ObjectMapper mapper = new ObjectMapper();
    private final IndexQueueRepository queue;
    private final Executor executor = Executors.newVirtualThreadPerTaskExecutor();

    public ElasticsearchIndexer(@Value("${elasticsearch.url:http://elasticsearch:9200}") String baseUrl,
                                 IndexQueueRepository queue) {
        this.baseUrl = baseUrl;
        this.queue = queue;
        this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    }

    /** Fire-and-forget index push; failures are queued for IndexRetryScheduler, never thrown. */
    public void indexAsync(VulnerabilityRecord record) {
        CompletableFuture.runAsync(() -> {
            try {
                indexNow(record);
            } catch (Exception e) {
                log.warn("elasticsearch-indexing-failure vuln_id={} vuln_key={} message={}",
                    record.id(), record.vulnKey(), e.getMessage());
                queue.enqueue(record.id(), e.getMessage());
            }
        }, executor);
    }

    /**
     * Synchronous index push used both by indexAsync() and by
     * IndexRetryScheduler when replaying a queued record. Uses vulnKey as
     * the deterministic document _id (PUT /{index}/_doc/{id}) -- re-running
     * this for the same vulnerability always updates the same document,
     * which is what makes re-indexing idempotent.
     */
    public void indexNow(VulnerabilityRecord record) throws Exception {
        ObjectNode doc = mapper.createObjectNode();
        doc.put("vulnKey", record.vulnKey());
        doc.put("worker", record.worker());
        doc.put("target", record.target());
        doc.put("port", record.port());
        doc.put("path", record.path());
        if (record.statusCode() != null) doc.put("statusCode", record.statusCode()); else doc.putNull("statusCode");
        doc.put("title", record.title());
        doc.put("severity", record.severity());
        doc.put("description", record.description());
        doc.put("remediation", record.remediation());
        doc.put("status", record.status());
        doc.put("affectedVersion", record.affectedVersion());
        doc.put("occurrenceCount", record.occurrenceCount());
        doc.put("profileId", record.profileId());
        doc.put("vulnerabilityId", record.id());
        doc.put("updatedAt", record.updatedAt().toString());
        doc.put("createdAt", record.createdAt().toString());

        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(baseUrl + "/" + INDEX_NAME + "/_doc/" + record.vulnKey()))
            .header("Content-Type", "application/json")
            .timeout(Duration.ofSeconds(10))
            .PUT(HttpRequest.BodyPublishers.ofString(doc.toString()))
            .build();

        HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() >= 300) {
            throw new IllegalStateException("Elasticsearch index push failed with status " + response.statusCode()
                + ": " + response.body());
        }
    }

    /**
     * Fire-and-forget delete of the document for vulnKey, mirroring
     * indexAsync's own best-effort shape -- a vulnerability's deletion from
     * Derby (the authoritative store) has already committed by the time this
     * runs, so Elasticsearch being unreachable here must not block or fail
     * the caller. Unlike indexAsync, a failure here is only logged, not
     * queued for retry: IndexRetryScheduler's queue is keyed by vulnerability
     * id and expects to re-index a still-existing row, not replay a delete
     * for a row that's already gone.
     */
    public void deleteAsync(String vulnKey) {
        CompletableFuture.runAsync(() -> {
            try {
                HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(baseUrl + "/" + INDEX_NAME + "/_doc/" + vulnKey))
                    .timeout(Duration.ofSeconds(10))
                    .DELETE()
                    .build();
                HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
                // 404 means there was never a document to delete (e.g. Elasticsearch
                // was down when this vulnerability was first indexed) -- not a failure.
                if (response.statusCode() >= 300 && response.statusCode() != 404) {
                    throw new IllegalStateException("Elasticsearch delete failed with status " + response.statusCode()
                        + ": " + response.body());
                }
            } catch (Exception e) {
                log.warn("elasticsearch-delete-failure vuln_key={} message={}", vulnKey, e.getMessage());
            }
        }, executor);
    }
}
