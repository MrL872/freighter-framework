package com.example.application.persistence;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * Reads finding_templates (see V011__finding_templates.sql). Writes aren't
 * needed yet -- rows are seeded by the migration itself; editing them later
 * is the "future feature" this table is a foundation for.
 */
@Repository
public class FindingTemplateRepository {
    private final JdbcTemplate jdbc;

    public FindingTemplateRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Every template row for one worker: its exact-title rows plus, if present, its title-IS-NULL wildcard row. */
    public List<FindingTemplateRecord> findByWorker(String worker) {
        return jdbc.query(
            "SELECT id, worker, title, description_template, remediation_template, created_at, updated_at " +
            "FROM finding_templates WHERE worker = ?",
            (rs, row) -> new FindingTemplateRecord(rs.getLong("id"), rs.getString("worker"), rs.getString("title"),
                rs.getString("description_template"), rs.getString("remediation_template"),
                rs.getTimestamp("created_at").toLocalDateTime(), rs.getTimestamp("updated_at").toLocalDateTime()),
            worker);
    }
}
