-- V011__finding_templates.sql's ('wafw00f', 'No WAF detected') row was edited
-- after V011 had already run on existing databases (DatabaseMigrationRunner
-- applies each numbered migration exactly once -- see its own class doc), so
-- that edit never reached any database that had already migrated past V011.
-- Those databases kept falling through to the ('wafw00f', NULL) wildcard row
-- instead, producing the illogical "it is protected by the No WAF detected
-- WAF" description. This migration carries the corrected text to those
-- databases -- UPDATE handles the already-applied-but-stale row, and the
-- guarded INSERT covers the unlikely case where the row is missing entirely.
-- (DatabaseMigrationRunner splits this whole file on every semicolon
-- character, comments included, so none of this comment block may contain
-- one -- that is what broke the first version of this migration.)
UPDATE finding_templates
SET description_template = 'The wafw00f worker detected no WAF protection on the host: {path}',
    remediation_template = 'Put a WAF in front of {path}: turn on a managed WAF if the app sits behind a cloud load balancer or CDN (AWS WAF, the Cloudflare WAF, Azure Front Door WAF, or Google Cloud Armor), or self-host one by deploying ModSecurity (or Coraza) with the OWASP Core Rule Set on the reverse proxy in front of the application. Then re-run wafw00f against {path} to confirm it now reports a WAF.',
    updated_at = CURRENT_TIMESTAMP
WHERE worker = 'wafw00f' AND title = 'No WAF detected';

INSERT INTO finding_templates (worker, title, description_template, remediation_template, created_at, updated_at)
SELECT 'wafw00f', 'No WAF detected',
    'The wafw00f worker detected no WAF protection on the host: {path}',
    'Put a WAF in front of {path}: turn on a managed WAF if the app sits behind a cloud load balancer or CDN (AWS WAF, the Cloudflare WAF, Azure Front Door WAF, or Google Cloud Armor), or self-host one by deploying ModSecurity (or Coraza) with the OWASP Core Rule Set on the reverse proxy in front of the application. Then re-run wafw00f against {path} to confirm it now reports a WAF.',
    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM SYSIBM.SYSDUMMY1
WHERE NOT EXISTS (SELECT 1 FROM finding_templates WHERE worker = 'wafw00f' AND title = 'No WAF detected');
