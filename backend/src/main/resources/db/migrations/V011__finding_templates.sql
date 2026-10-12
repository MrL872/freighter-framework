-- Report-style Description/Remediation templates for the vulnerability
-- ledger, keyed by (worker, title). FindingTemplateService looks these up
-- at read time -- every /<tool>/findings call -- and renders them from
-- each finding's own target/path/port/severity/title/raw-description, so
-- editing a row here reformats every past finding too, not just new scans.
-- This is the foundation the ledger's Description/Remediation columns are
-- meant to be: an admin-editing UI for this table is a natural next step,
-- but nothing about how it is read would need to change for that.
--
-- title is NULL for a worker whose title is itself open-ended per finding
-- (nuclei's template name, gitleaks' rule id, wafw00f's WAF name) -- that
-- row is the wildcard FindingTemplateService falls back to when no exact
-- title match exists, and its templates reference {title} directly instead
-- of treating it as a fixed lookup key.
--
-- Placeholders available to every template: {target} {path} {port}
-- {worker} {severity} {title} {raw} (the worker's own original
-- description text, kept as an escape hatch for tool-specific detail that
-- has no dedicated column, e.g. nmap's service/version string).
--
-- masscan and gowitness are deliberately not seeded here: masscan has no
-- backend findings() endpoint (it is not in WIRED_WORKERS), and gowitness's
-- /gowitness/findings always returns an empty list (screenshots are kept in
-- Image Storage, not the job-result ledger) -- see each Controller's own
-- doc comment. nosqlmap is wired with the same findings() pattern as every
-- other worker but its own worker produces no findings at all (dormant
-- placeholder -- see wiredWorkers.js), so it has nothing to template either.
CREATE TABLE finding_templates (
    id BIGINT NOT NULL GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    worker VARCHAR(64) NOT NULL,
    title VARCHAR(255),
    description_template VARCHAR(2000) NOT NULL,
    remediation_template VARCHAR(2000) NOT NULL,
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL
);

CREATE INDEX finding_templates_worker_idx ON finding_templates(worker);

INSERT INTO finding_templates (worker, title, description_template, remediation_template, created_at, updated_at) VALUES
('subfinder', 'Subdomain discovered',
 'The subfinder worker found a vulnerability on the {target} domain: this subdomain is publicly exposed and was not previously known to be in scope.',
 'Open your DNS provider dashboard or zone file and delete the A or CNAME record for this subdomain (or remove it from your infrastructure-as-code config, e.g. Route53 or Cloudflare), then confirm with "dig {target}" that it no longer resolves.',
 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

('shuffledns', 'Subdomain resolved',
 'The shuffledns worker found a vulnerability on the {target} domain: this subdomain resolves to a live host.',
 'Open your DNS provider dashboard or zone file and delete the record for this subdomain, then confirm with "dig {target}" that it stops resolving.',
 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

('puredns', 'Domain resolved',
 'The puredns worker found a vulnerability on the {target} domain: this domain resolves to a live host.',
 'Open your DNS provider dashboard or zone file and delete the record for this domain, then confirm with "dig {target}" that it stops resolving.',
 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

('nuclei', NULL,
 'The nuclei worker found a vulnerability on the {target} domain at {path}, matching the {title} detection template.',
 'Open the {title}.yaml template in the nuclei-templates repository for its own remediation notes, apply the vendor patch or config change it points to, then re-run nuclei against {target} to confirm the finding clears.',
 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

('ffuf', 'Fuzzing match found',
 'The ffuf worker found a vulnerability on the {target} domain at {path}: {raw}.',
 'Add a deny rule for this path in your web server or reverse proxy config (an Nginx location block, or a .htaccess Deny directive), or delete the file or endpoint outright, then re-run ffuf to confirm it now 404s.',
 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

('katana', 'URL crawled',
 'The katana worker found a vulnerability on the {target} domain at {path}.',
 'Add an auth check or reverse-proxy ACL rule in front of this URL, or remove the route from the app router entirely if it should not be public.',
 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

('nmap', 'Open port discovered',
 'The nmap worker found a vulnerability on the {target} target: port {port} is open, running {raw}.',
 'Stop the service (systemctl stop <service>, or stop the container) if it does not need to be public, or block the port at the firewall (ufw deny {port}, or a security group rule). If it must stay open, update the service via your package manager to its latest version and change any default credentials in its config file.',
 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

('hydra', 'Valid credentials found',
 'The hydra worker found a vulnerability on the {target} target: valid login credentials were recovered via {raw}.',
 'Change this password now in the account settings, add login rate limiting with a tool like fail2ban or a login-throttling middleware, and turn on multi-factor authentication if the service offers it.',
 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

('wpscan', 'wpscan finding',
 'The wpscan worker found a vulnerability on the {target} WordPress site: {raw}.',
 'Run "wp core update", "wp plugin update --all", and "wp theme update --all" via WP-CLI (or update from the WP Admin dashboard), remove any plugin or theme you do not use, and install a login-hardening plugin such as Limit Login Attempts or enable WordPress native two-factor option.',
 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

('sstimap', 'Possible SSTI vulnerability',
 'The sstimap worker found a vulnerability on the {target} target: {raw}.',
 'Change the vulnerable call from rendering a string built with user input (e.g. render_template_string(user_input)) to rendering a fixed template file with the input passed only as a variable (e.g. render_template("page.html", value=user_input)).',
 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

('wafw00f', NULL,
 'The wafw00f worker found a vulnerability on the {target} target: it is protected by the {title} WAF.',
 'Do not stop at the WAF result: open the other scanner findings for this same target (nuclei, sqlmap, etc.) and patch each one directly in the application code or server config.',
 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

('wafw00f', 'No WAF detected',
 'The wafw00f worker detected no WAF protection on the host: {path}',
 'Put a WAF in front of {path}: turn on a managed WAF if the app sits behind a cloud load balancer or CDN (AWS WAF, the Cloudflare WAF, Azure Front Door WAF, or Google Cloud Armor), or self-host one by deploying ModSecurity (or Coraza) with the OWASP Core Rule Set on the reverse proxy in front of the application. Then re-run wafw00f against {path} to confirm it now reports a WAF.',
 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

('jwt-tool', 'jwt_tool finding',
 'The jwt-tool worker found a vulnerability while testing a JSON Web Token: {raw}.',
 'In the token verification code, hardcode the expected signing algorithm when calling the JWT library (e.g. jwt.decode(token, key, algorithms=["RS256"])) instead of trusting the alg header, and rotate the signing key through your secrets manager if it may have leaked.',
 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

('fuxploider', 'File upload vulnerability',
 'The fuxploider worker found a vulnerability on the {target} target: {raw}.',
 'In the upload handler, check the uploaded file content server-side using a library like python-magic (not just the extension), write uploads to a folder outside the web root or to object storage such as S3, and make sure that folder has no execute permission and is not served directly by the web server config.',
 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

('gitleaks', NULL,
 'The gitleaks worker found a vulnerability of type {title} in {path}.',
 'Revoke or rotate the exposed secret right away in the provider console (AWS IAM, the GitHub tokens page, etc.), then strip it from git history with git filter-repo or BFG Repo-Cleaner, force-push the cleaned history, and add gitleaks as a pre-commit hook or CI step to catch the next one before it is committed.',
 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

('gau', 'URL discovered',
 'The gau worker found a vulnerability on the {target} domain: an archived URL was discovered at {path}.',
 'Add this URL to your reverse proxy deny list or application route guard, or delete it from the codebase if nothing still serves it.',
 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

('dirsearch', 'Path discovered',
 'The dirsearch worker found a vulnerability on the {target} domain at {path}: {raw}.',
 'Add a deny rule for this path in your web server or reverse proxy config, or delete the file, directory, or endpoint outright, then re-run dirsearch to confirm it now 404s.',
 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

('xsstrike', 'Possible XSS vulnerability',
 'The xsstrike worker found a vulnerability on the {target} target: {raw}.',
 'Switch from raw string output to the auto-escaping syntax your templating engine already provides (Jinja2 {{ }} instead of | safe, React JSX escaping by default, etc.), and add a Content-Security-Policy response header restricting script-src to trusted origins.',
 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),

('sqlmap', 'Possible SQL injection',
 'The sqlmap worker found a vulnerability on the {target} target: {raw}.',
 'Replace string-concatenated SQL with parameterized queries (e.g. cursor.execute("...WHERE id = %s", (id,)) instead of an f-string), and create a dedicated database user for the app that only has the grants it needs, without DROP or ALTER.',
 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
