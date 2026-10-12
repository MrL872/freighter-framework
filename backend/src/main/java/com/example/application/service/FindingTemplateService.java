package com.example.application.service;

import com.example.application.persistence.FindingTemplateRecord;
import com.example.application.persistence.FindingTemplateRepository;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Renders a finding's Description/Remediation from a report-style template
 * stored in finding_templates (see V011__finding_templates.sql), looked up
 * by (worker, title). Every worker *Controller#findings() calls apply()
 * right before returning, so this runs at read time -- not when a finding
 * is first ingested -- which means editing a template later reformats every
 * past finding too, not just new scans. This is the "foundation for future
 * features" the ledger's Description/Remediation columns are meant to be:
 * today the templates are fixed at seed time, but nothing about this reads
 * them any differently than it would from an admin-editable table later.
 *
 * A worker whose title is itself open-ended per finding (nuclei's template
 * name, gitleaks' rule id, wafw00f's WAF name) has no row for every
 * possible title; its one title-IS-NULL row is the wildcard this falls
 * back to, with {title} available for that template to reference directly.
 * A finding whose (worker, title) has no exact or wildcard row keeps
 * whatever description/remediation the worker itself already wrote -- a
 * title nobody has written a template for yet never regresses to blank.
 */
@Service
public class FindingTemplateService {
    private final FindingTemplateRepository templates;

    public FindingTemplateService(FindingTemplateRepository templates) {
        this.templates = templates;
    }

    public void apply(List<Map<String, Object>> findings, String worker) {
        if (findings.isEmpty()) return;
        List<FindingTemplateRecord> rows = templates.findByWorker(worker);
        if (rows.isEmpty()) return;

        FindingTemplateRecord wildcard = null;
        Map<String, FindingTemplateRecord> byTitle = new HashMap<>();
        for (FindingTemplateRecord row : rows) {
            if (row.title() == null) wildcard = row;
            else byTitle.put(row.title(), row);
        }

        for (Map<String, Object> finding : findings) {
            String title = asString(finding.get("title"));
            FindingTemplateRecord template = byTitle.getOrDefault(title, wildcard);
            if (template == null) continue;

            Map<String, String> vars = new HashMap<>();
            vars.put("target", orBlank(finding.get("target")));
            vars.put("path", orBlank(finding.get("path")));
            vars.put("port", orBlank(finding.get("port")));
            vars.put("worker", worker);
            vars.put("severity", orBlank(finding.get("severity")));
            vars.put("title", title == null ? "" : title);
            vars.put("raw", orBlank(finding.get("description")));

            finding.put("description", render(template.descriptionTemplate(), vars));
            finding.put("remediation", render(template.remediationTemplate(), vars));
        }
    }

    private static String render(String template, Map<String, String> vars) {
        String result = template;
        for (Map.Entry<String, String> entry : vars.entrySet()) {
            result = result.replace("{" + entry.getKey() + "}", entry.getValue());
        }
        return result;
    }

    private static String asString(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private static String orBlank(Object value) {
        String s = asString(value);
        return (s == null || s.isBlank() || "-".equals(s)) ? "" : s;
    }
}
