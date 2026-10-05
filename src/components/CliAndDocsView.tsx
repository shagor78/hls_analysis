import React, { useState } from 'react';
import { BookOpen, CheckCircle2, Play, RefreshCw, Terminal } from 'lucide-react';

interface TestCaseResult {
  id: string;
  suite: string;
  name: string;
  passed: boolean;
  duration_ms: number;
  assertion_detail: string;
}

interface Props {
  onRefresh: () => Promise<void>;
  notify: (msg: string, type?: 'success' | 'error') => void;
}

const CLI_PRESET_COMMANDS = [
  'ott-tool scan https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8 --timeout 8000 --retries 3',
  'ott-tool analyze https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
  'ott-tool validate playlist.m3u --concurrency 5 --rate-limit 10',
  'ott-tool export channels.m3u --format m3u --output channels.m3u',
  'ott-tool backup database',
  'ott-tool migrate database',
  'ott-tool report --format json',
];

const DOCS_ARTICLES: Record<string, { title: string; content: string }> = {
  'README.md': {
    title: 'README.md — Architecture & Security Mandate',
    content: `StreamVault OTT / HLS Migration & Backup Tool (Authorized Systems Only)

1. Goal:
   Migrate and back up your own OTT platform from one server to another without manually collecting thousands of channel URLs.

2. Non-Negotiable Security Rules:
   - Only process resources you own or have explicit written authorization to access.
   - Never bypass authentication (401/403), DRM (#EXT-X-KEY), CAPTCHA, WAF, or rate limits.
   - Never extract or log passwords, session cookies, JWT secrets, API keys, or payment credentials.
   - All secrets are masked as ************ in UI, exports, and logs/audit.log.`,
  },
  'INSTALL.md': {
    title: 'INSTALL.md — Local & Docker Deployment',
    content: `Local Setup:
  npm install
  cp .env.example .env
  npm run dev

Docker Compose Setup (backend + frontend + postgres + persistent volumes):
  docker compose up --build -d

Persistent Volumes:
  ./data     -> Operational database & scan checkpoints
  ./backups  -> Timestamped database & media archive snapshots
  ./exports  -> Generated .m3u, .json, .csv, and .sql bundles
  ./logs     -> Immutable security & operational audit logs`,
  },
  'CONFIGURATION.md': {
    title: 'CONFIGURATION.md — Environment Variables',
    content: `Environment Variables (.env):
  DATABASE_URL="sqlite:///./data/ott_migration.db"
  ALLOW_PRIVATE_NETWORKS="false"
  URL_ALLOWLIST=""
  AUDIT_LOG_PATH="./logs/audit.log"
  DEFAULT_TIMEOUT_MS="8000"
  DEFAULT_MAX_RETRIES="3"
  DEFAULT_CONCURRENCY="5"
  DEFAULT_RATE_LIMIT_RPS="10"`,
  },
  'CLI.md': {
    title: 'CLI.md — ott-tool Command Reference',
    content: `Supported Commands:
  ott-tool scan <URL>
  ott-tool analyze <M3U8_URL>
  ott-tool validate playlist.m3u
  ott-tool export channels.m3u
  ott-tool backup database
  ott-tool migrate database
  ott-tool report

Supported Flags:
  --timeout <ms>       Connection timeout (default 8000)
  --retries <count>    Exponential backoff retry count (default 3)
  --concurrency <num>  Worker pool size (default 5)
  --rate-limit <rps>   Max requests per second (default 10)
  --output <file>      Output filename in exports/
  --format <fmt>       json | m3u | csv | text`,
  },
  'API.md': {
    title: 'API.md — REST API Reference',
    content: `Core Endpoints:
  GET  /api/state                -> Full inventory, metrics, and audit logs
  POST /api/scan                 -> Multi-source scanner with SSRF guard
  POST /api/hls/analyze          -> Master/Variant M3U8 dependency analyzer
  POST /api/m3u/parse            -> Standard IPTV M3U parser & duplicate detector
  POST /api/validate             -> Concurrent stream validator
  POST /api/db/inspect           -> Authorized PostgreSQL/MySQL/SQLite schema inspector
  POST /api/db/migrate           -> 9-step transactional database migrator
  POST /api/api-migration/run    -> Paginated GET/POST JSON/XML API migrator
  POST /api/media-backup/run     -> Metadata Only & Media Archive backup manager
  GET  /api/export/:filename     -> Download channels.m3u, channels.json, scan-report.json`,
  },
  'DATABASE_MIGRATION.md': {
    title: 'DATABASE_MIGRATION.md — 9-Step Migration Protocol',
    content: `Mandatory 9-Step Database Migration Workflow:
  1. Detect tables
  2. Show table names
  3. Show row counts
  4. Show foreign key relationships
  5. Select tables to migrate
  6. Create mandatory backup snapshot in backups/
  7. Validate schema compatibility
  8. Perform transactional migration (masking sensitive columns as ************)
  9. Verify post-migration row counts`,
  },
  'SECURITY.md': {
    title: 'SECURITY.md — SSRF Protection & Access Control Policy',
    content: `Security Controls Implemented:
  - SSRF Guard: Blocks 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, and 169.254.169.254 unless explicitly permitted by the administrator.
  - Secret Masking: Passwords, tokens, and API keys are masked as ************.
  - Access Control Respect: HTTP 401/403 responses immediately halt retries and record UNAUTHORIZED.
  - DRM Respect: #EXT-X-KEY encrypted streams are flagged and never decrypted.`,
  },
  'TROUBLESHOOTING.md': {
    title: 'TROUBLESHOOTING.md — Common Operational Resolutions',
    content: `1. Private IP Blocked by SSRF Guard:
   Enable "Allow Private LAN Networks" in Security Settings only when migrating an authorized LAN origin.

2. Stream Marked UNAUTHORIZED (HTTP 401/403):
   Verify origin CDN token permissions; StreamVault never attempts to circumvent authentication.

3. Stream Marked INVALID_M3U8:
   Confirm the URL points directly to a manifest beginning with #EXTM3U rather than an HTML wrapper page.`,
  },
};

export const CliAndDocsView: React.FC<Props> = ({ onRefresh, notify }) => {
  const [commandInput, setCommandInput] = useState<string>(CLI_PRESET_COMMANDS[1]);
  const [cliOutput, setCliOutput] = useState<string>(
    'StreamVault CLI Ready. Select a preset command or type an `ott-tool` command above and click Execute.'
  );
  const [cliBusy, setCliBusy] = useState<boolean>(false);

  const [testResults, setTestResults] = useState<TestCaseResult[]>([]);
  const [testBusy, setTestBusy] = useState<boolean>(false);
  const [selectedDoc, setSelectedDoc] = useState<string>('README.md');

  const handleRunCli = async (cmdToRun = commandInput) => {
    setCliBusy(true);
    try {
      const res = await fetch('/api/cli/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commandLine: cmdToRun }),
      });
      const data = await res.json();
      setCliOutput(`$ ${cmdToRun}\n\n${data.output}`);
      await onRefresh();
    } catch (err: unknown) {
      setCliOutput(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCliBusy(false);
    }
  };

  const handleRunTests = async () => {
    setTestBusy(true);
    try {
      const res = await fetch('/api/tests/run', { method: 'POST' });
      const data = await res.json();
      setTestResults(data.results || []);
      notify(`Executed ${data.total} automated tests: ${data.passed} passed, ${data.failed} failed.`);
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Test execution failed', 'error');
    } finally {
      setTestBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Interactive CLI Section */}
      <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 rounded-lg space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Terminal className="w-5 h-5 text-emerald-500" />
              Interactive CLI Runner (ott-tool)
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Execute <code className="font-mono">ott-tool</code> commands with <code className="font-mono">--timeout</code>, <code className="font-mono">--retries</code>, <code className="font-mono">--concurrency</code>, <code className="font-mono">--rate-limit</code>, <code className="font-mono">--output</code>, and <code className="font-mono">--format</code>.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {CLI_PRESET_COMMANDS.map((preset) => (
            <button
              key={preset}
              onClick={() => {
                setCommandInput(preset);
                handleRunCli(preset);
              }}
              className="px-2.5 py-1 text-xs font-mono border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {preset.split(' ').slice(0, 3).join(' ')}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={commandInput}
            onChange={(e) => setCommandInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRunCli();
            }}
            className="flex-1 px-3 py-2 text-xs font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-transparent"
          />
          <button
            disabled={cliBusy}
            onClick={() => handleRunCli()}
            className="px-4 py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-md flex items-center gap-2 whitespace-nowrap"
          >
            {cliBusy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Execute CLI
          </button>
        </div>

        <pre className="p-4 rounded-md bg-slate-950 text-emerald-400 font-mono text-xs leading-relaxed overflow-x-auto border border-slate-800 max-h-80">
          {cliOutput}
        </pre>
      </div>

      {/* Automated Verification Test Suite (Section 15) */}
      <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 rounded-lg space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">
              12-Part Automated Verification & Security Test Suite
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Verifies M3U/M3U8 parsers, HLS master/variant dependency trees, JSON API normalization, DB migration, duplicate detection, stream validation, timeouts, exponential backoff, export/import, and SSRF/masking controls using sample test data.
            </p>
          </div>
          <button
            disabled={testBusy}
            onClick={handleRunTests}
            className="px-4 py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-md flex items-center gap-2 whitespace-nowrap shrink-0"
          >
            {testBusy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Run All 12 Test Suites
          </button>
        </div>

        {testResults.length > 0 && (
          <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-md">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-500">
                <tr>
                  <th className="py-2.5 px-3">Suite</th>
                  <th className="py-2.5 px-3">Test Case</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3 text-right">Duration</th>
                  <th className="py-2.5 px-3">Assertion Telemetry</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono tabular-nums">
                {testResults.map((t) => (
                  <tr key={t.id}>
                    <td className="py-2.5 px-3 font-semibold">{t.suite}</td>
                    <td className="py-2.5 px-3 font-sans">{t.name}</td>
                    <td className="py-2.5 px-3 text-emerald-500 font-semibold">
                      {t.passed ? 'PASS' : 'FAIL'}
                    </td>
                    <td className="py-2.5 px-3 text-right">{t.duration_ms}ms</td>
                    <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400">
                      {t.assertion_detail}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Documentation Viewer (Section 18) */}
      <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 rounded-lg space-y-4">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-emerald-500" />
          <h3 className="text-base font-semibold">Project Documentation Suite</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          {Object.keys(DOCS_ARTICLES).map((docKey) => (
            <button
              key={docKey}
              onClick={() => setSelectedDoc(docKey)}
              className={`px-3 py-1.5 text-xs font-mono rounded-md transition-colors ${
                selectedDoc === docKey
                  ? 'bg-emerald-600 text-white'
                  : 'border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {docKey}
            </button>
          ))}
        </div>
        <div className="p-4 rounded-md bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
          <div className="text-sm font-semibold mb-2">
            {DOCS_ARTICLES[selectedDoc]?.title}
          </div>
          <pre className="text-xs font-mono whitespace-pre-wrap text-slate-700 dark:text-slate-300 leading-relaxed">
            {DOCS_ARTICLES[selectedDoc]?.content}
          </pre>
        </div>
      </div>
    </div>
  );
};
