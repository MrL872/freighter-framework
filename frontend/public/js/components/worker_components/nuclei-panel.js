// Nuclei control panel. Same approach as subfinder-panel.js: every button
// below corresponds to a flag documented in
// .github/worker_instructions/nuclei.md, grouped the same way that doc
// groups them (TARGET, TARGET-FORMAT, TEMPLATES, FILTERING, OUTPUT,
// CONFIGURATIONS, INTERACTSH, FUZZING, UNCOVER, RATE-LIMIT, OPTIMIZATIONS,
// HEADLESS, DEBUG, UPDATE, HONEYPOT, STATISTICS, CLOUD, AUTHENTICATION) —
// Toggling a flag builds up the command preview live, and drives a
// real backend run (see the ctx.emit('nuclei:flags', ...) call in
// renderCommand() below, same wiring as subfinder-panel.js).
//
// A flag marked isFile expects an existing file (a target list, a template
// or workflow file/directory, a resolver list, a client cert, ...) rather
// than an arbitrary typed value — for those, clicking the flag opens an
// expandable list of whatever's actually saved in the selected profile's
// Project Folder (see projectFolder.js) instead of a plain text popup. A
// single target (-u), a tag/severity list, or a number (-rl, -timeout, ...)
// has no such picker — it's still the plain text popup.
//
// A flag marked isOutput instead writes a result to disk (-o, -srd, -rdb,
// -me, -se, -je, -jle, -pe, -tlog, -elog) — its value popup adds a
// one-click suggestion to save into Project Folder instead of leaving the
// user to type an arbitrary path.
import { store } from '../../store.js';
import { getSession } from '../../workerSession.js';
import { suppressTransition } from '../../domTransition.js';
import { projectFolder } from '../../projectFolder.js';
import { WORDLIST_BROWSE_HTML, bindWordlistBrowse } from '../../wordlistBrowser.js';
import { CONFIG_BROWSE_HTML, bindConfigBrowse } from '../../configBrowser.js';
import { commandPreviewHtml, bindCommandPreview } from '../../commandPreview.js';
import { flagSearchHtml, bindFlagSearch } from '../../flagSearch.js';
import { addOutputDestination, destinationValue } from '../../outputDestination.js';

const FLAG_SECTIONS = [
  {
    group: 'basic', title: 'TARGET', flags: [
      { flag: '-u', alias: '-target', takesValue: true, desc: 'target URLs/hosts to scan' },
      { flag: '-l', alias: '-list', takesValue: true, isFile: true, desc: 'path to file containing a list of target URLs/hosts to scan (one per line)' },
      { flag: '-targets-inline', takesValue: true, desc: 'inline multiline target list (for use in template profiles)' },
      { flag: '-eh', alias: '-exclude-hosts', takesValue: true, desc: 'hosts to exclude to scan from the input list (ip, cidr, hostname)' },
      { flag: '-resume', takesValue: true, isFile: true, desc: 'resume scan from and save to specified file (clustering will be disabled)' },
      { flag: '-sa', alias: '-scan-all-ips', takesValue: false, desc: "scan all the IP's associated with dns record" },
      { flag: '-iv', alias: '-ip-version', takesValue: true, desc: 'IP version to scan of hostname (4,6) - (default 4)' },
    ],
  },
  {
    group: 'basic', title: 'TARGET-FORMAT', flags: [
      { flag: '-im', alias: '-input-mode', takesValue: true, desc: 'mode of input file (list, burp, jsonl, yaml, openapi, swagger) (default "list")' },
      { flag: '-ro', alias: '-required-only', takesValue: false, desc: 'use only required fields in input format when generating requests' },
      { flag: '-sfv', alias: '-skip-format-validation', takesValue: false, desc: 'skip format validation (like missing vars) when parsing input file' },
      { flag: '-vtt', alias: '-vars-text-templating', takesValue: false, desc: 'enable text templating for vars in input file (only for yaml input mode)' },
      { flag: '-vfp', alias: '-var-file-paths', takesValue: true, isFile: true, desc: 'list of yaml file contained vars to inject into yaml input' },
    ],
  },
  {
    group: 'basic', title: 'TEMPLATES', flags: [
      { flag: '-nt', alias: '-new-templates', takesValue: false, desc: 'run only new templates added in latest nuclei-templates release' },
      { flag: '-ntv', alias: '-new-templates-version', takesValue: true, desc: 'run new templates added in specific version' },
      { flag: '-as', alias: '-automatic-scan', takesValue: false, desc: 'automatic web scan using wappalyzer technology detection to tags mapping' },
      { flag: '-t', alias: '-templates', takesValue: true, isFile: true, desc: 'list of template or template directory to run (comma-separated, file)' },
      { flag: '-turl', alias: '-template-url', takesValue: true, desc: 'template url or list containing template urls to run (comma-separated, file)' },
      { flag: '-ai', alias: '-prompt', takesValue: true, desc: 'generate and run template using ai prompt' },
      { flag: '-w', alias: '-workflows', takesValue: true, isFile: true, desc: 'list of workflow or workflow directory to run (comma-separated, file)' },
      { flag: '-wurl', alias: '-workflow-url', takesValue: true, desc: 'workflow url or list containing workflow urls to run (comma-separated, file)' },
      { flag: '-validate', takesValue: false, desc: 'validate the passed templates to nuclei' },
      { flag: '-nss', alias: '-no-strict-syntax', takesValue: false, desc: 'disable strict syntax check on templates' },
      { flag: '-td', alias: '-template-display', takesValue: false, desc: 'displays the templates content' },
      { flag: '-tl', takesValue: false, desc: 'list all templates matching current filters' },
      { flag: '-tgl', takesValue: false, desc: 'list all available tags' },
      { flag: '-sign', takesValue: false, desc: 'signs the templates with the private key defined in NUCLEI_SIGNATURE_PRIVATE_KEY env variable' },
      { flag: '-code', takesValue: false, desc: 'enable loading code protocol-based templates' },
      { flag: '-dut', alias: '-disable-unsigned-templates', takesValue: false, desc: 'disable running unsigned templates or templates with mismatched signature' },
      { flag: '-esc', alias: '-enable-self-contained', takesValue: false, desc: 'enable loading self-contained templates' },
      { flag: '-egm', alias: '-enable-global-matchers', takesValue: false, desc: 'enable loading global matchers templates' },
      { flag: '-file', takesValue: false, desc: 'enable loading file templates' },
    ],
  },
  {
    group: 'basic', title: 'FILTERING', flags: [
      { flag: '-a', alias: '-author', takesValue: true, desc: 'templates to run based on authors (comma-separated, file)' },
      { flag: '-tags', takesValue: true, desc: 'templates to run based on tags (comma-separated, file)' },
      { flag: '-etags', alias: '-exclude-tags', takesValue: true, desc: 'templates to exclude based on tags (comma-separated, file)' },
      { flag: '-itags', alias: '-include-tags', takesValue: true, desc: 'tags to be executed even if they are excluded either by default or configuration' },
      { flag: '-id', alias: '-template-id', takesValue: true, desc: 'templates to run based on template ids (comma-separated, file, allow-wildcard)' },
      { flag: '-eid', alias: '-exclude-id', takesValue: true, desc: 'templates to exclude based on template ids (comma-separated, file)' },
      { flag: '-it', alias: '-include-templates', takesValue: true, isFile: true, desc: 'path to template file or directory to be executed even if they are excluded either by default or configuration' },
      { flag: '-et', alias: '-exclude-templates', takesValue: true, isFile: true, desc: 'path to template file or directory to exclude (comma-separated, file)' },
      { flag: '-em', alias: '-exclude-matchers', takesValue: true, desc: 'template matchers to exclude in result' },
      { flag: '-s', alias: '-severity', takesValue: true, desc: 'templates to run based on severity. Possible values: info, low, medium, high, critical, unknown' },
      { flag: '-es', alias: '-exclude-severity', takesValue: true, desc: 'templates to exclude based on severity. Possible values: info, low, medium, high, critical, unknown' },
      { flag: '-pt', alias: '-type', takesValue: true, desc: 'templates to run based on protocol type. Possible values: dns, file, http, headless, tcp, workflow, ssl, websocket, whois, code, javascript' },
      { flag: '-ept', alias: '-exclude-type', takesValue: true, desc: 'templates to exclude based on protocol type. Possible values: dns, file, http, headless, tcp, workflow, ssl, websocket, whois, code, javascript' },
      { flag: '-tc', alias: '-template-condition', takesValue: true, desc: 'templates to run based on expression condition' },
    ],
  },
  {
    group: 'basic', title: 'OUTPUT', flags: [
      { flag: '-o', alias: '-output', takesValue: true, isOutput: true, desc: 'output file to write found issues/vulnerabilities' },
      { flag: '-sresp', alias: '-store-resp', takesValue: false, desc: 'store all request/response passed through nuclei to output directory' },
      { flag: '-srd', alias: '-store-resp-dir', takesValue: true, isOutput: true, desc: 'store all request/response passed through nuclei to custom directory (default "output")' },
      { flag: '-silent', takesValue: false, desc: 'display findings only' },
      { flag: '-nc', alias: '-no-color', takesValue: false, desc: 'disable output content coloring (ANSI escape codes)' },
      { flag: '-j', alias: '-jsonl', takesValue: false, desc: 'write output in JSONL(ines) format' },
      { flag: '-irr', alias: '-include-rr', takesValue: false, desc: 'include request/response pairs in the JSON, JSONL, and Markdown outputs (for findings only) [DEPRECATED use -omit-raw] (default true)' },
      { flag: '-or', alias: '-omit-raw', takesValue: false, desc: 'omit request/response pairs in the JSON, JSONL, Markdown, and PDF outputs (for findings only)' },
      { flag: '-ot', alias: '-omit-template', takesValue: false, desc: 'omit encoded template in the JSON, JSONL output' },
      { flag: '-nm', alias: '-no-meta', takesValue: false, desc: 'disable printing result metadata in cli output' },
      { flag: '-ts', alias: '-timestamp', takesValue: false, desc: 'enables printing timestamp in cli output' },
      { flag: '-rdb', alias: '-report-db', takesValue: true, isOutput: true, desc: 'nuclei reporting database (always use this to persist report data)' },
      { flag: '-ms', alias: '-matcher-status', takesValue: false, desc: 'display match failure status' },
      { flag: '-me', alias: '-markdown-export', takesValue: true, isOutput: true, desc: 'directory to export results in markdown format' },
      { flag: '-se', alias: '-sarif-export', takesValue: true, isOutput: true, desc: 'file to export results in SARIF format' },
      { flag: '-je', alias: '-json-export', takesValue: true, isOutput: true, desc: 'file to export results in JSON format' },
      { flag: '-jle', alias: '-jsonl-export', takesValue: true, isOutput: true, desc: 'file to export results in JSONL(ine) format' },
      { flag: '-pe', alias: '-pdf-export', takesValue: true, isOutput: true, desc: 'file to export results in PDF format' },
      { flag: '-rd', alias: '-redact', takesValue: true, desc: 'redact given list of keys from query parameter, request header and body' },
    ],
  },
  {
    group: 'advanced', title: 'CONFIGURATIONS', flags: [
      { flag: '-config', takesValue: true, isFile: true, desc: 'path to the nuclei configuration file' },
      { flag: '-tp', alias: '-profile', takesValue: true, isFile: true, desc: 'template profile config file to run' },
      { flag: '-tpl', alias: '-profile-list', takesValue: false, desc: 'list community template profiles' },
      { flag: '-fr', alias: '-follow-redirects', takesValue: false, desc: 'enable following redirects for http templates' },
      { flag: '-fhr', alias: '-follow-host-redirects', takesValue: false, desc: 'follow redirects on the same host' },
      { flag: '-mr', alias: '-max-redirects', takesValue: true, desc: 'max number of redirects to follow for http templates (default 10)' },
      { flag: '-dr', alias: '-disable-redirects', takesValue: false, desc: 'disable redirects for http templates' },
      { flag: '-rc', alias: '-report-config', takesValue: true, isFile: true, desc: 'nuclei reporting module configuration file' },
      { flag: '-H', alias: '-header', takesValue: true, desc: 'custom header/cookie to include in all http request in header:value format (cli, file)' },
      { flag: '-V', alias: '-var', takesValue: true, desc: 'custom vars in key=value format' },
      { flag: '-r', alias: '-resolvers', takesValue: true, isFile: true, desc: 'file containing resolver list for nuclei' },
      { flag: '-sr', alias: '-system-resolvers', takesValue: false, desc: 'use system DNS resolving as error fallback' },
      { flag: '-dc', alias: '-disable-clustering', takesValue: false, desc: 'disable clustering of requests' },
      { flag: '-passive', takesValue: false, desc: 'enable passive HTTP response processing mode' },
      { flag: '-fh2', alias: '-force-http2', takesValue: false, desc: 'force http2 connection on requests' },
      { flag: '-ev', alias: '-env-vars', takesValue: false, desc: 'enable environment variables to be used in template' },
      { flag: '-cc', alias: '-client-cert', takesValue: true, isFile: true, desc: 'client certificate file (PEM-encoded) used for authenticating against scanned hosts' },
      { flag: '-ck', alias: '-client-key', takesValue: true, isFile: true, desc: 'client key file (PEM-encoded) used for authenticating against scanned hosts' },
      { flag: '-ca', alias: '-client-ca', takesValue: true, isFile: true, desc: 'client certificate authority file (PEM-encoded) used for authenticating against scanned hosts' },
      { flag: '-sml', alias: '-show-match-line', takesValue: false, desc: 'show match lines for file templates, works with extractors only' },
      { flag: '-ztls', takesValue: false, desc: 'use ztls library with autofallback to standard one for tls13 [Deprecated] autofallback to ztls is enabled by default' },
      { flag: '-sni', takesValue: true, desc: 'tls sni hostname to use (default: input domain name)' },
      { flag: '-dka', alias: '-dialer-keep-alive', takesValue: true, desc: 'keep-alive duration for network requests.' },
      { flag: '-lfa', alias: '-allow-local-file-access', takesValue: false, desc: 'allows file (payload) access anywhere on the system' },
      { flag: '-lna', alias: '-restrict-local-network-access', takesValue: false, desc: 'blocks connections to the local / private network' },
      { flag: '-i', alias: '-interface', takesValue: true, desc: 'network interface to use for network scan' },
      { flag: '-at', alias: '-attack-type', takesValue: true, desc: 'type of payload combinations to perform (batteringram,pitchfork,clusterbomb)' },
      { flag: '-sip', alias: '-source-ip', takesValue: true, desc: 'source ip address to use for network scan' },
      { flag: '-rsr', alias: '-response-size-read', takesValue: true, desc: 'max response size to read in bytes' },
      { flag: '-rss', alias: '-response-size-save', takesValue: true, desc: 'max response size to read in bytes (default 1048576)' },
      { flag: '-reset', takesValue: false, desc: 'reset removes all nuclei configuration and data files (including nuclei-templates)' },
      { flag: '-tlsi', alias: '-tls-impersonate', takesValue: false, desc: 'enable experimental client hello (ja3) tls randomization' },
      { flag: '-hae', alias: '-http-api-endpoint', takesValue: true, desc: 'experimental http api endpoint' },
    ],
  },
  {
    group: 'advanced', title: 'INTERACTSH', flags: [
      { flag: '-iserver', alias: '-interactsh-server', takesValue: true, desc: 'interactsh server url for self-hosted instance (default: oast.pro,oast.live,oast.site,oast.online,oast.fun,oast.me)' },
      { flag: '-itoken', alias: '-interactsh-token', takesValue: true, desc: 'authentication token for self-hosted interactsh server' },
      { flag: '-interactions-cache-size', takesValue: true, desc: 'number of requests to keep in the interactions cache (default 5000)' },
      { flag: '-interactions-eviction', takesValue: true, desc: 'number of seconds to wait before evicting requests from cache (default 60)' },
      { flag: '-interactions-poll-duration', takesValue: true, desc: 'number of seconds to wait before each interaction poll request (default 5)' },
      { flag: '-interactions-cooldown-period', takesValue: true, desc: 'extra time for interaction polling before exiting (default 5)' },
      { flag: '-ni', alias: '-no-interactsh', takesValue: false, desc: 'disable interactsh server for OAST testing, exclude OAST based templates' },
    ],
  },
  {
    group: 'advanced', title: 'FUZZING', flags: [
      { flag: '-ft', alias: '-fuzzing-type', takesValue: true, desc: 'overrides fuzzing type set in template (replace, prefix, postfix, infix)' },
      { flag: '-fm', alias: '-fuzzing-mode', takesValue: true, desc: 'overrides fuzzing mode set in template (multiple, single)' },
      { flag: '-fuzz', takesValue: false, desc: 'enable loading fuzzing templates (Deprecated: use -dast instead)' },
      { flag: '-dast', takesValue: false, desc: 'enable / run dast (fuzz) nuclei templates' },
      { flag: '-dts', alias: '-dast-server', takesValue: false, desc: 'enable dast server mode (live fuzzing)' },
      { flag: '-dtr', alias: '-dast-report', takesValue: false, desc: 'write dast scan report to file' },
      { flag: '-dtst', alias: '-dast-server-token', takesValue: true, desc: 'dast server token (optional)' },
      { flag: '-dtsa', alias: '-dast-server-address', takesValue: true, desc: 'dast server address (default "localhost:9055")' },
      { flag: '-dfp', alias: '-display-fuzz-points', takesValue: false, desc: 'display fuzz points in the output for debugging' },
      { flag: '-fuzz-param-frequency', takesValue: true, desc: 'frequency of uninteresting parameters for fuzzing before skipping (default 10)' },
      { flag: '-fa', alias: '-fuzz-aggression', takesValue: true, desc: 'fuzzing aggression level controls payload count for fuzz (low, medium, high) (default "low")' },
      { flag: '-cs', alias: '-fuzz-scope', takesValue: true, desc: 'in scope url regex to be followed by fuzzer' },
      { flag: '-cos', alias: '-fuzz-out-scope', takesValue: true, desc: 'out of scope url regex to be excluded by fuzzer' },
    ],
  },
  {
    group: 'advanced', title: 'UNCOVER', flags: [
      { flag: '-uc', alias: '-uncover', takesValue: false, desc: 'enable uncover engine' },
      { flag: '-uq', alias: '-uncover-query', takesValue: true, desc: 'uncover search query' },
      { flag: '-ue', alias: '-uncover-engine', takesValue: true, desc: 'uncover search engine (shodan,censys,fofa,shodan-idb,quake,hunter,zoomeye,netlas,criminalip,publicwww,hunterhow,google,odin,binaryedge,onyphe,driftnet,greynoise,daydaymap,nerdydata) (default shodan)' },
      { flag: '-uf', alias: '-uncover-field', takesValue: true, desc: 'uncover fields to return (ip,port,host) (default "ip:port")' },
      { flag: '-ul', alias: '-uncover-limit', takesValue: true, desc: 'uncover results to return (default 100)' },
      { flag: '-ur', alias: '-uncover-ratelimit', takesValue: true, desc: 'override ratelimit of engines with unknown ratelimit (default 60 req/min) (default 60)' },
    ],
  },
  {
    group: 'advanced', title: 'RATE-LIMIT', flags: [
      { flag: '-rl', alias: '-rate-limit', takesValue: true, desc: 'maximum number of requests to send per second (default 150)' },
      { flag: '-rld', alias: '-rate-limit-duration', takesValue: true, desc: 'maximum number of requests to send per second (default 1s)' },
      { flag: '-rlm', alias: '-rate-limit-minute', takesValue: true, desc: 'maximum number of requests to send per minute (DEPRECATED)' },
      { flag: '-bs', alias: '-bulk-size', takesValue: true, desc: 'maximum number of hosts to be analyzed in parallel per template (default 25)' },
      { flag: '-c', alias: '-concurrency', takesValue: true, desc: 'maximum number of templates to be executed in parallel (default 25)' },
      { flag: '-hbs', alias: '-headless-bulk-size', takesValue: true, desc: 'maximum number of headless hosts to be analyzed in parallel per template (default 10)' },
      { flag: '-headc', alias: '-headless-concurrency', takesValue: true, desc: 'maximum number of headless templates to be executed in parallel (default 10)' },
      { flag: '-jsc', alias: '-js-concurrency', takesValue: true, desc: 'maximum number of javascript runtimes to be executed in parallel (default 120)' },
      { flag: '-pc', alias: '-payload-concurrency', takesValue: true, desc: 'max payload concurrency for each template (default 25)' },
      { flag: '-prc', alias: '-probe-concurrency', takesValue: true, desc: 'http probe concurrency with httpx (default 50)' },
      { flag: '-tlc', alias: '-template-loading-concurrency', takesValue: true, desc: 'maximum number of concurrent template loading operations (default 50)' },
    ],
  },
  {
    group: 'advanced', title: 'OPTIMIZATIONS', flags: [
      { flag: '-timeout', takesValue: true, desc: 'time to wait in seconds before timeout (default 10)' },
      { flag: '-retries', takesValue: true, desc: 'number of times to retry a failed request (default 1)' },
      { flag: '-ldp', alias: '-leave-default-ports', takesValue: false, desc: 'leave default HTTP/HTTPS ports (eg. host:80,host:443)' },
      { flag: '-mhe', alias: '-max-host-error', takesValue: true, desc: 'max errors for a host before skipping from scan (default 30)' },
      { flag: '-te', alias: '-track-error', takesValue: true, desc: 'adds given error to max-host-error watchlist (standard, file)' },
      { flag: '-nmhe', alias: '-no-mhe', takesValue: false, desc: 'disable skipping host from scan based on errors' },
      { flag: '-project', takesValue: false, desc: 'use a project folder to avoid sending same request multiple times' },
      { flag: '-project-path', takesValue: true, desc: 'set a specific project path (default "/tmp")' },
      { flag: '-spm', alias: '-stop-at-first-match', takesValue: false, desc: 'stop processing HTTP requests after the first match (may break template/workflow logic)' },
      { flag: '-stream', takesValue: false, desc: 'stream mode - start elaborating without sorting the input' },
      { flag: '-ss', alias: '-scan-strategy', takesValue: true, desc: 'strategy to use while scanning(auto/host-spray/template-spray) (default auto)' },
      { flag: '-irt', alias: '-input-read-timeout', takesValue: true, desc: 'timeout on input read (default 3m0s)' },
      { flag: '-nh', alias: '-no-httpx', takesValue: false, desc: 'disable httpx probing for non-url input' },
      { flag: '-no-stdin', takesValue: false, desc: 'disable stdin processing' },
    ],
  },
  {
    group: 'advanced', title: 'HEADLESS', flags: [
      { flag: '-headless', takesValue: false, desc: 'enable templates that require headless browser support (root user on Linux will disable sandbox)' },
      { flag: '-page-timeout', takesValue: true, desc: 'seconds to wait for each page in headless mode (default 20)' },
      { flag: '-sb', alias: '-show-browser', takesValue: false, desc: 'show the browser on the screen when running templates with headless mode' },
      { flag: '-ho', alias: '-headless-options', takesValue: true, desc: 'start headless chrome with additional options' },
      { flag: '-sc', alias: '-system-chrome', takesValue: false, desc: 'use local installed Chrome browser instead of nuclei installed' },
      { flag: '-cdpe', alias: '-cdp-endpoint', takesValue: true, desc: 'use remote browser via Chrome DevTools Protocol (CDP) endpoint' },
      { flag: '-lha', alias: '-list-headless-action', takesValue: false, desc: 'list available headless actions' },
    ],
  },
  {
    group: 'advanced', title: 'DEBUG', flags: [
      { flag: '-debug', takesValue: false, desc: 'show all requests and responses' },
      { flag: '-dreq', alias: '-debug-req', takesValue: false, desc: 'show all sent requests' },
      { flag: '-dresp', alias: '-debug-resp', takesValue: false, desc: 'show all received responses' },
      { flag: '-p', alias: '-proxy', takesValue: true, desc: 'list of http/socks5 proxy to use (comma separated or file input)' },
      { flag: '-pi', alias: '-proxy-internal', takesValue: false, desc: 'proxy all internal requests' },
      { flag: '-ldf', alias: '-list-dsl-function', takesValue: false, desc: 'list all supported DSL function signatures' },
      { flag: '-tlog', alias: '-trace-log', takesValue: true, isOutput: true, desc: 'file to write sent requests trace log' },
      { flag: '-elog', alias: '-error-log', takesValue: true, isOutput: true, desc: 'file to write sent requests error log' },
      { flag: '-version', takesValue: false, desc: 'show nuclei version' },
      { flag: '-hm', alias: '-hang-monitor', takesValue: false, desc: 'enable nuclei hang monitoring' },
      { flag: '-v', alias: '-verbose', takesValue: false, desc: 'show verbose output' },
      { flag: '-profile-mem', takesValue: true, desc: 'generate memory (heap) profile & trace files' },
      { flag: '-vv', takesValue: false, desc: 'display templates loaded for scan' },
      { flag: '-svd', alias: '-show-var-dump', takesValue: false, desc: 'show variables dump for debugging' },
      { flag: '-vdl', alias: '-var-dump-limit', takesValue: true, desc: 'limit the number of characters displayed in var dump (default 255)' },
      { flag: '-ep', alias: '-enable-pprof', takesValue: false, desc: 'enable pprof debugging server' },
      { flag: '-tv', alias: '-templates-version', takesValue: false, desc: 'shows the version of the installed nuclei-templates' },
      { flag: '-hc', alias: '-health-check', takesValue: false, desc: 'run diagnostic check up' },
    ],
  },
  {
    group: 'advanced', title: 'UPDATE', flags: [
      { flag: '-ut', alias: '-update-templates', takesValue: false, desc: 'update nuclei-templates to latest released version' },
      { flag: '-ud', alias: '-update-template-dir', takesValue: true, desc: 'custom directory to install / update nuclei-templates' },
      { flag: '-duc', alias: '-disable-update-check', takesValue: false, desc: 'disable automatic nuclei/templates update check' },
    ],
  },
  {
    group: 'advanced', title: 'HONEYPOT', flags: [
      { flag: '-hpd', alias: '-honeypot-detect', takesValue: false, desc: 'detect potential honeypot hosts based on match concentration' },
      { flag: '-hpt', alias: '-honeypot-threshold', takesValue: true, desc: 'number of distinct template IDs required to flag a honeypot host (default 15)' },
      { flag: '-shp', alias: '-suppress-honeypot', takesValue: false, desc: 'suppress output for flagged honeypot hosts' },
    ],
  },
  {
    group: 'advanced', title: 'STATISTICS', flags: [
      { flag: '-stats', takesValue: false, desc: 'display statistics about the running scan' },
      { flag: '-sj', alias: '-stats-json', takesValue: false, desc: 'display statistics in JSONL(ines) format' },
      { flag: '-si', alias: '-stats-interval', takesValue: true, desc: 'number of seconds to wait between showing a statistics update (default 5)' },
      { flag: '-mp', alias: '-metrics-port', takesValue: true, desc: 'port to expose nuclei metrics on (default 9092)' },
      { flag: '-hps', alias: '-http-stats', takesValue: false, desc: 'enable http status capturing (experimental)' },
    ],
  },
  {
    group: 'advanced', title: 'CLOUD', flags: [
      { flag: '-auth', takesValue: false, desc: 'configure projectdiscovery cloud (pdcp) api key (default true)' },
      { flag: '-tid', alias: '-team-id', takesValue: true, desc: 'upload scan results to given team id (optional) (default "none")' },
      { flag: '-cup', alias: '-cloud-upload', takesValue: false, desc: 'upload scan results to pdcp dashboard [DEPRECATED use -dashboard]' },
      { flag: '-sid', alias: '-scan-id', takesValue: true, desc: 'upload scan results to existing scan id (optional)' },
      { flag: '-sname', alias: '-scan-name', takesValue: true, desc: 'scan name to set (optional)' },
      { flag: '-pd', alias: '-dashboard', takesValue: false, desc: 'upload / view nuclei results in projectdiscovery cloud (pdcp) UI dashboard' },
      { flag: '-pdu', alias: '-dashboard-upload', takesValue: true, desc: 'upload / view nuclei results file (jsonl) in projectdiscovery cloud (pdcp) UI dashboard' },
    ],
  },
  {
    group: 'advanced', title: 'AUTHENTICATION', flags: [
      { flag: '-sf', alias: '-secret-file', takesValue: true, isFile: true, desc: 'path to config file containing secrets for nuclei authenticated scan' },
      { flag: '-ps', alias: '-prefetch-secrets', takesValue: false, desc: 'prefetch secrets from the secrets file' },
    ],
  },
];

function flagLabel(f) { return f.alias ? `${f.flag}, ${f.alias}` : f.flag; }
// Safe for both an HTML attribute and a text node — used for flag
// descriptions (from this file, trusted) and, below, for Project Folder
// file names (user-entered via rename, not trusted).
function escapeHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function renderSection(section) {
  return `
    <div class="flag-section">
      <h4 class="flag-section-title">${section.title}</h4>
      <div class="flag-btns">
        ${section.flags.map(f => `
          <span class="flag-btn-wrap">
            <button type="button" class="flag-btn" data-flag="${f.flag}" data-takes-value="${f.takesValue}" data-is-file="${!!f.isFile}" data-is-output="${!!f.isOutput}" data-output-target="${f.outputTarget || 'project'}"
              aria-pressed="false" title="${escapeHtml(f.desc)}">${flagLabel(f)}</button>
          </span>`).join('')}
      </div>
    </div>`;
}

function renderGroup(id, title, sections) {
  return `
    <div class="flag-group">
      <button type="button" class="flag-group-head" aria-expanded="false" aria-controls="flags-${id}">
        <span class="glyph" aria-hidden="true">&gt;</span>${title}
      </button>
      <div class="flag-group-body-wrap">
        <div class="flag-group-body" id="flags-${id}">
          ${sections.map(renderSection).join('')}
        </div>
      </div>
    </div>`;
}

export default {
  id: 'nuclei-panel',
  css: ['static/worker-view.css', 'static/flag-panel.css'],
  critical: false,
  mount(container, ctx) {
    const basicSections = FLAG_SECTIONS.filter(s => s.group === 'basic');
    const advancedSections = FLAG_SECTIONS.filter(s => s.group === 'advanced');

    container.innerHTML = `
      <div class="panel-head">Control panel${flagSearchHtml()}</div>
      <div class="control-body">
        ${renderGroup('basic', 'Basic flags', basicSections)}
        ${renderGroup('advanced', 'Advanced flags', advancedSections)}
      </div>
      ${commandPreviewHtml('nuclei')}`;

    // Every worker switch remounts this panel from scratch (see
    // showWorkerView() in index.js) — guard each collapsible group's
    // fresh .flag-group-body-wrap the same way page navigation guards
    // main's own grid-template-rows transition, so it can never misread
    // its very first style application as something worth animating.
    container.querySelectorAll('.flag-group-body-wrap').forEach(suppressTransition);
    container.querySelectorAll('.flag-group-head').forEach(btn => {
      btn.addEventListener('click', () => {
        const open = btn.getAttribute('aria-expanded') !== 'true';
        btn.setAttribute('aria-expanded', String(open));
      });
    });

    const preview = bindCommandPreview(container, {
      onClear: clearAllFlags,
      flagDefs: FLAG_SECTIONS.flatMap(s => s.flags),
      onApply(parsed) {
        active.clear();
        parsed.forEach((v, k) => active.set(k, v));
        container.querySelectorAll('.flag-btn').forEach(btn => {
          const on = active.has(btn.dataset.flag);
          btn.setAttribute('aria-pressed', String(on));
          btn.classList.toggle('active', on);
        });
        renderCommand();
      },
    });
    bindFlagSearch(container);
    // flag -> value ('' for boolean flags that are simply on/off)
    // Persisted across mounts (see workerSession.js) -- switching away from
    // this worker's view and back (or to a different worker and back)
    // shouldn't reset flags already built up here.
    const session = getSession('nuclei');
    const active = session.activeFlags;

    function renderCommand() {
      const tokens = ['nuclei'];
      container.querySelectorAll('.flag-btn').forEach(btn => {
        const flag = btn.dataset.flag;
        if (!active.has(flag)) return;
        const value = active.get(flag);
        tokens.push(value ? `${flag} ${value}` : flag);
      });
      preview.setGenerated(tokens.join(' '));
      // live-terminal.js's Send button has no other way to see what this
      // panel has built -- it doesn't import this module (each worker's
      // control panel is loaded independently, see index.js's
      // loadControlPanel) -- so the current flag selection travels over the
      // shared ctx bus instead, same principle as chat-toggle.js/menu.js.
      ctx.emit('nuclei:flags', Object.fromEntries(active));
    }

    // At most one value popup open at a time — opening another, or any
    // outside interaction, cancels whichever one is still open.
    let closeOpenPopup = null;

    function openValuePopup(btn) {
      if (closeOpenPopup) closeOpenPopup();
      const flag = btn.dataset.flag;
      const wrap = btn.closest('.flag-btn-wrap');
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'flag-value-popup';
      input.setAttribute('aria-label', `Value for ${flag}`);
      input.placeholder = 'value...';
      const popup = document.createElement('div');
      popup.className = 'flag-value-popup-wrap';
      popup.appendChild(input);
      // Output-writing flags (a scan result saved to disk) point at Project
      // Folder instead of leaving the user to type an arbitrary path -- the
      // one place a saved value later shows up again in this UI (see
      // js/projectFolder.js).
      // Appended to <body> at a viewport-fixed position (computed from the
      // button's own rect) rather than left inside .flag-btn-wrap — a
      // wrap nested under overflow:hidden/auto ancestors (the scrollable
      // .control-body, the collapsing .flag-group-body) would otherwise
      // clip or bury the popup instead of floating it above everything.
      if (btn.dataset.isOutput === 'true') addOutputDestination(popup, input, btn);
      const anchorRect = btn.getBoundingClientRect();
      popup.style.left = `${anchorRect.right + 4}px`;
      popup.style.top = `${anchorRect.top}px`;
      document.body.appendChild(popup);
      input.focus();

      const cleanup = () => {
        popup.remove();
        if (closeOpenPopup === cleanup) closeOpenPopup = null;
        document.removeEventListener('mousedown', onOutside, true);
        window.removeEventListener('scroll', onScroll, true);
      };
      const onOutside = e => { if (!wrap.contains(e.target) && !popup.contains(e.target)) cleanup(); };
      document.addEventListener('mousedown', onOutside, true);
      // A detached, fixed-position popup doesn't track its anchor while a
      // scrollable ancestor (e.g. .control-body) scrolls under it, so close
      // it rather than let it drift away from the button that opened it.
      // Scroll events from inside the popup (its input scrolling sideways as text
      // is typed or pasted past its width) must not close it.
      const onScroll = e => { if (!(e.target instanceof Element && popup.contains(e.target))) cleanup(); };
      window.addEventListener('scroll', onScroll, true);

      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const value = destinationValue(btn, input);
          if (value === null) return;
          cleanup();
          if (!value) return;
          active.set(flag, value);
          btn.setAttribute('aria-pressed', 'true');
          btn.classList.add('active');
          renderCommand();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cleanup();
        }
      });

      closeOpenPopup = cleanup;
    }

    // File-taking flags (-l, -resume, -vfp, -t, -w, -it, -et, -config, -tp,
    // -rc, -r, -cc, -ck, -ca, -sf, ...) pick from whatever the selected
    // profile actually has saved in its Project Folder, instead of a blind
    // typed value — same storage wordlist-template.js/send-output.js write
    // into (see js/projectFolder.js).
    function openFilePopup(btn) {
      if (closeOpenPopup) closeOpenPopup();
      const flag = btn.dataset.flag;
      const wrap = btn.closest('.flag-btn-wrap');
      const panel = document.createElement('div');
      panel.className = 'flag-file-popup';
      panel.setAttribute('role', 'listbox');
      panel.setAttribute('aria-label', `Project Folder files for ${flag}`);
      panel.innerHTML = '<div class="flag-file-status">Loading Project Folder…</div>';
      // Appended to <body> at a viewport-fixed position (computed from the
      // button's own rect) rather than left inside .flag-btn-wrap — see the
      // matching comment in openValuePopup above for why.
      const anchorRect = btn.getBoundingClientRect();
      panel.style.left = `${anchorRect.left}px`;
      panel.style.top = `${anchorRect.bottom + 4}px`;
      document.body.appendChild(panel);

      const cleanup = () => {
        panel.remove();
        if (closeOpenPopup === cleanup) closeOpenPopup = null;
        document.removeEventListener('mousedown', onOutside, true);
        document.removeEventListener('keydown', onKeydown, true);
        window.removeEventListener('scroll', onScroll, true);
      };
      const onOutside = e => { if (!wrap.contains(e.target) && !panel.contains(e.target)) cleanup(); };
      const onKeydown = e => { if (e.key === 'Escape') { e.preventDefault(); cleanup(); } };
      document.addEventListener('mousedown', onOutside, true);
      document.addEventListener('keydown', onKeydown, true);
      // See the matching scroll listener in openValuePopup above.
      // Scroll events from inside the popup (its input scrolling sideways as text
      // is typed or pasted past its width) must not close it.
      const onScroll = e => { if (!(e.target instanceof Element && panel.contains(e.target))) cleanup(); };
      window.addEventListener('scroll', onScroll, true);
      closeOpenPopup = cleanup;

      function pick(name) {
        cleanup();
        active.set(flag, name);
        btn.setAttribute('aria-pressed', 'true');
        btn.classList.add('active');
        renderCommand();
      }

      if (!store.current()) {
        panel.innerHTML = '<div class="flag-file-status">Select a company profile to browse its Project Folder.</div>' + WORDLIST_BROWSE_HTML + CONFIG_BROWSE_HTML;
        bindWordlistBrowse(panel, pick);
        bindConfigBrowse(panel, pick);
        return;
      }
      projectFolder.list().then(files => {
        if (closeOpenPopup !== cleanup) return; // closed/replaced while this was in flight
        panel.innerHTML = (files.length ? files.map(f => `<button type="button" class="flag-file-option" role="option" data-name="${escapeHtml(f.name)}">${escapeHtml(f.name)}</button>`).join('') : '<div class="flag-file-status">No files saved in the Project Folder yet.</div>') + WORDLIST_BROWSE_HTML + CONFIG_BROWSE_HTML;
        panel.querySelectorAll('.flag-file-option[data-name]').forEach(optBtn => {
          optBtn.addEventListener('click', () => pick(optBtn.dataset.name));
        });
        bindWordlistBrowse(panel, pick);
        bindConfigBrowse(panel, pick);
      });
    }

    container.querySelectorAll('.flag-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const flag = btn.dataset.flag;
        const takesValue = btn.dataset.takesValue === 'true';
        if (active.has(flag)) {
          active.delete(flag);
          btn.setAttribute('aria-pressed', 'false');
          btn.classList.remove('active');
          renderCommand();
          return;
        }
        if (takesValue) {
          if (btn.dataset.isFile === 'true') openFilePopup(btn);
          else openValuePopup(btn);
          return;
        }
        active.set(flag, '');
        btn.setAttribute('aria-pressed', 'true');
        btn.classList.add('active');
        renderCommand();
      });
    });

    // Repaint flags already active from a previous mount (see workerSession.js
    // above) instead of starting the button bar empty.
    if (active.size) {
      container.querySelectorAll('.flag-btn').forEach(btn => {
        if (active.has(btn.dataset.flag)) {
          btn.setAttribute('aria-pressed', 'true');
          btn.classList.add('active');
        }
      });
      renderCommand();
    }

    // [CLEAR] unpins every flag and rebuilds the bar empty.
    function clearAllFlags() {
      active.clear();
      container.querySelectorAll('.flag-btn').forEach(btn => {
        btn.setAttribute('aria-pressed', 'false');
        btn.classList.remove('active');
      });
      renderCommand();
    }

    const copyBtn = container.querySelector('#command-preview-copy');
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(preview.text());
        copyBtn.textContent = '[Copied]';
      } catch {
        copyBtn.textContent = '[Copy failed]';
      }
      setTimeout(() => { copyBtn.textContent = '[Copy]'; }, 1500);
    });
  },
};
