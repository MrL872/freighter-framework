package com.example.application.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Translates a VulnerabilityController search request into an Elasticsearch
 * query and executes it. This is the restricted, backend-owned query path.
 * The frontend container also has a read-only route to Elasticsearch (see
 * VulnerabilityController's class comment), so search results do not reach
 * the browser only through this service.
 */
@Service
public class ElasticsearchQueryService {
    private static final Logger log = LoggerFactory.getLogger(ElasticsearchQueryService.class);

    private final String baseUrl;
    private final HttpClient http;
    private final ObjectMapper mapper = new ObjectMapper();

    public ElasticsearchQueryService(@Value("${elasticsearch.url:http://elasticsearch:9200}") String baseUrl) {
        this.baseUrl = baseUrl;
        this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    }

    public record SearchResult(List<Map<String, Object>> hits, long total, boolean degraded) {}

    public SearchResult search(String query, String vulnId, String severity, String target, String version,
                                String status, String profileId, int page, int size, String sortField,
                                String sortDirection) {
        int from = Math.max(0, page) * Math.max(1, size);

        ObjectNode body = mapper.createObjectNode();
        body.put("from", from);
        body.put("size", Math.max(1, Math.min(size, 200)));

        ArrayNode must = mapper.createArrayNode();
        if (query != null && !query.isBlank()) {
            ObjectNode multiMatch = mapper.createObjectNode();
            ObjectNode inner = multiMatch.putObject("multi_match");
            inner.put("query", query);
            ArrayNode fields = inner.putArray("fields");
            fields.add("title").add("description").add("remediation").add("target").add("path").add("worker");
            must.add(multiMatch);
        }
        if (vulnId != null && !vulnId.isBlank()) {
            must.add(term("vulnKey", vulnId));
        }
        if (severity != null && !severity.isBlank()) {
            must.add(term("severity", severity.toUpperCase()));
        }
        // target and affectedVersion are text fields with a .keyword subfield,
        // so filtering goes through that subfield rather than the analyzed
        // text field. The .keyword subfields carry a lowercase normalizer
        // (see ElasticsearchIndexInitializer's MAPPING), which Elasticsearch
        // applies to this wildcard query's value as well as to the indexed
        // value, so these filters stay case-insensitive. A wildcard
        // "*value*" (rather than term's exact-whole-field match) is what
        // makes "example" actually find "sub.example.com:8080" -- these are
        // substring filters, not exact-match ones, the same expectation a
        // text search box anywhere else in this app already sets. Every
        // other filtered field below is a plain keyword field queried
        // exactly, by its own name.
        if (target != null && !target.isBlank()) {
            must.add(wildcard("target.keyword", target));
        }
        if (version != null && !version.isBlank()) {
            must.add(wildcard("affectedVersion.keyword", version));
        }
        if (status != null && !status.isBlank()) {
            must.add(term("status", status.toUpperCase()));
        }
        if (profileId != null && !profileId.isBlank()) {
            must.add(term("profileId", profileId));
        }

        ObjectNode queryNode = body.putObject("query");
        if (must.isEmpty()) {
            queryNode.putObject("match_all");
        } else {
            queryNode.putObject("bool").set("must", must);
        }

        if (sortField != null && !sortField.isBlank()) {
            ArrayNode sort = body.putArray("sort");
            ObjectNode sortEntry = mapper.createObjectNode();
            sortEntry.putObject(sortField).put("order", "desc".equalsIgnoreCase(sortDirection) ? "desc" : "asc");
            sort.add(sortEntry);
        }

        try {
            HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(baseUrl + "/" + ElasticsearchIndexer.INDEX_NAME + "/_search"))
                .header("Content-Type", "application/json")
                .timeout(Duration.ofSeconds(10))
                .POST(HttpRequest.BodyPublishers.ofString(body.toString()))
                .build();
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() >= 300) {
                log.warn("elasticsearch-query-failure status={} body={}", response.statusCode(), response.body());
                return new SearchResult(List.of(), 0, true);
            }
            return parse(response.body());
        } catch (Exception e) {
            // Elasticsearch unavailability degrades search only -- it must
            // never surface as an application error.
            log.warn("elasticsearch-connection-failure message={}", e.getMessage());
            return new SearchResult(List.of(), 0, true);
        }
    }

    private ObjectNode term(String field, String value) {
        ObjectNode termNode = mapper.createObjectNode();
        termNode.putObject("term").put(field, value);
        return termNode;
    }

    /**
     * Substring filter: wraps value in "*...*" for Elasticsearch's wildcard query, so e.g. "example" matches
     * "sub.example.com:8080" instead of requiring an exact whole-field match (what term() does). Escapes any
     * "*" or "?" literally present in the typed value first, with a backslash, so a user searching for a
     * target that genuinely contains one of those characters doesn't have it reinterpreted as a wildcard.
     */
    private ObjectNode wildcard(String field, String value) {
        String escaped = value.replace("\\", "\\\\").replace("*", "\\*").replace("?", "\\?");
        ObjectNode wildcardNode = mapper.createObjectNode();
        wildcardNode.putObject("wildcard").putObject(field).put("value", "*" + escaped + "*").put("case_insensitive", true);
        return wildcardNode;
    }

    private SearchResult parse(String responseBody) {
        JsonNode root = mapper.readTree(responseBody);
        JsonNode hitsNode = root.path("hits");
        long total = hitsNode.path("total").path("value").asLong(0);
        List<Map<String, Object>> hits = new ArrayList<>();
        for (JsonNode hit : hitsNode.path("hits")) {
            Map<String, Object> source = mapper.convertValue(hit.get("_source"), new TypeReference<Map<String, Object>>() {});
            hits.add(source);
        }
        return new SearchResult(hits, total, false);
    }
}
