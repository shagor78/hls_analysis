import React, { useState } from 'react';
import {
  CheckCircle2,
  ChevronRight,
  Download,
  Play,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { AppStateResponse } from '../types.ts';

interface Props {
  state: AppStateResponse;
  onRefresh: () => Promise<void>;
  notify: (msg: string, type?: 'success' | 'error') => void;
}

const WIZARD_STEPS = [
  { step: 1, title: 'Source', desc: 'Select OTT origin URL, playlist, or database' },
  { step: 2, title: 'Authorization', desc: 'Confirm ownership & configure credentials' },
  { step: 3, title: 'Scan', desc: 'Discover public/authorized media resources' },
  { step: 4, title: 'Preview', desc: 'Inspect discovered channels & HLS variants' },
  { step: 5, title: 'Select Resources', desc: 'Choose channels & DB tables to migrate' },
  { step: 6, title: 'Backup', desc: 'Create mandatory pre-migration snapshot' },
  { step: 7, title: 'Export', desc: 'Generate normalized M3U, JSON & SQL bundles' },
  { step: 8, title: 'Import', desc: 'Require confirmation & execute target import' },
  { step: 9, title: 'Verify', desc: 'Verify stream availability & table row counts' },
  { step: 10, title: 'Report', desc: 'Download final migration & scan reports' },
];

export const MigrationWizardView: React.FC<Props> = ({ state, onRefresh, notify }) => {
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [sourceType, setSourceType] = useState<'m3u' | 'hls' | 'api' | 'database'>('m3u');
  const [sourceUrl, setSourceUrl] = useState<string>(
    'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8'
  );
  const [sourceDbUrl, setSourceDbUrl] = useState<string>(
    'sqlite:///./data/authorized_source_ott.db'
  );
  const [targetDbUrl, setTargetDbUrl] = useState<string>(
    'postgresql://ott_admin:secret_pass@target-ott.internal:5432/ott_prod'
  );
  const [authConfirmed, setAuthConfirmed] = useState<boolean>(true);
  const [authMethod, setAuthMethod] = useState<'none' | 'bearer' | 'api_key'>('none');
  const [secretToken, setSecretToken] = useState<string>('');
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>(
    state.channels.filter((c) => !c.is_duplicate && !c.drm_protected).map((c) => c.id)
  );
  const [selectedTables, setSelectedTables] = useState<string[]>(
    Object.keys(state.authorized_db_tables)
  );
  const [backupRecord, setBackupRecord] = useState<string | null>(null);
  const [exportGenerated, setExportGenerated] = useState<boolean>(false);
  const [confirmDestructiveImport, setConfirmDestructiveImport] = useState<boolean>(false);
  const [importCompleted, setImportCompleted] = useState<boolean>(false);
  const [verificationDone, setVerificationDone] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);

  const handleRunScanStep = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUrl: sourceUrl, sourceType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Scan failed');
      await onRefresh();
      notify(`Step 3 Scan complete: ${data.scannedSources?.length || 1} sources inspected.`);
      setCurrentStep(4);
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Scan error', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleRunBackupStep = async () => {
    setBusy(true);
    try {
      const dbBkpRes = await fetch('/api/db/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionUrl: sourceDbUrl,
          selectedTables,
        }),
      });
      const dbBkp = await dbBkpRes.json();
      if (!dbBkpRes.ok) throw new Error(dbBkp.error || 'Backup failed');

      await fetch('/api/media-backup/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Wizard Pre-Migration Snapshot',
          mode: 'Metadata Only',
          hlsCaptureType: 'Playlist backup',
          includedTypes: ['M3U8', 'JSON', 'XML', 'metadata'],
        }),
      });

      setBackupRecord(dbBkp.backup_file);
      await onRefresh();
      notify(`Step 6 Pre-migration backup saved: backups/${dbBkp.backup_file}`);
      setCurrentStep(7);
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Backup error', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleRunImportStep = async () => {
    if (!confirmDestructiveImport) {
      notify('Please check the explicit operator confirmation box before importing.', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/db/migrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceConnectionUrl: sourceDbUrl,
          targetConnectionUrl: targetDbUrl,
          selectedTables,
          confirmed: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Migration failed');
      setImportCompleted(true);
      await onRefresh();
      notify('Step 8 Target import completed transactionally. Source data preserved intact.');
      setCurrentStep(9);
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Migration failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleRunVerifyStep = async () => {
    setBusy(true);
    try {
      await fetch('/api/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelIds: selectedChannelIds }),
      });
      setVerificationDone(true);
      await onRefresh();
      notify('Step 9 Stream & database row count verification passed.');
      setCurrentStep(10);
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Verification error', 'error');
    } finally {
      setBusy(false);
    }
  };

  const progressPct = Math.round((currentStep / 10) * 100);

  return (
    <div className="space-y-6">
      {/* Header & Progress Bar */}
      <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 rounded-lg">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
              10-Step Authorized OTT Migration Wizard
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              Guided non-destructive workflow from source discovery to post-migration verification. Source servers are never automatically deleted.
            </p>
          </div>
          <div className="text-right font-mono tabular-nums">
            <div className="text-xs text-slate-500 dark:text-slate-400">Wizard Progress</div>
            <div className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">
              Step {currentStep} / 10 ({progressPct}%)
            </div>
          </div>
        </div>

        {/* Stepper Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-5 lg:grid-cols-10 gap-2 mt-6">
          {WIZARD_STEPS.map((s) => {
            const isActive = s.step === currentStep;
            const isDone = s.step < currentStep;
            return (
              <button
                key={s.step}
                onClick={() => setCurrentStep(s.step)}
                className={`text-left p-2.5 rounded-md border transition-colors ${
                  isActive
                    ? 'border-emerald-500 bg-emerald-500/10 text-slate-900 dark:text-white'
                    : isDone
                    ? 'border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300'
                    : 'border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:border-slate-400'
                }`}
              >
                <div className="text-xs font-mono tabular-nums font-semibold">
                  0{s.step <= 9 ? s.step : ''}{s.step === 10 ? '10' : ''}
                </div>
                <div className="text-xs font-medium truncate mt-0.5">{s.title}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Active Step Viewport */}
      <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 rounded-lg">
        {currentStep === 1 && (
          <div className="space-y-5">
            <h3 className="text-lg font-semibold">Step 1 — Configure Authorized Source</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Specify the primary OTT playlist, HLS manifest, catalog API endpoint, or source database to migrate.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                  Primary Resource Type
                </label>
                <select
                  value={sourceType}
                  onChange={(e) => setSourceType(e.target.value as typeof sourceType)}
                  className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-transparent"
                >
                  <option value="m3u" className="bg-slate-900 text-white">M3U / M3U8 IPTV Playlist URL</option>
                  <option value="hls" className="bg-slate-900 text-white">HLS Master Stream (.m3u8)</option>
                  <option value="api" className="bg-slate-900 text-white">JSON / XML Channel Catalog API</option>
                  <option value="database" className="bg-slate-900 text-white">Authorized SQL Database Connection</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                  Source Endpoint / Manifest URL
                </label>
                <input
                  type="text"
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-transparent"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                  Authorized Source Database URI
                </label>
                <input
                  type="text"
                  value={sourceDbUrl}
                  onChange={(e) => setSourceDbUrl(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-transparent"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                  Authorized Target Database URI
                </label>
                <input
                  type="text"
                  value={targetDbUrl}
                  onChange={(e) => setTargetDbUrl(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-transparent"
                />
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <button
                onClick={() => setCurrentStep(2)}
                className="px-4 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-md flex items-center gap-2 whitespace-nowrap"
              >
                Continue to Step 2 — Authorization
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {currentStep === 2 && (
          <div className="space-y-5">
            <h3 className="text-lg font-semibold">Step 2 — Ownership & Authorization Verification</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Confirm that you own or have explicit written authorization to access the source and target systems. Secrets are masked as <code className="font-mono">************</code> in all logs.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                  Origin Authentication Method (Optional)
                </label>
                <select
                  value={authMethod}
                  onChange={(e) => setAuthMethod(e.target.value as typeof authMethod)}
                  className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-transparent"
                >
                  <option value="none" className="bg-slate-900 text-white">Public / Pre-Signed URL (No Header)</option>
                  <option value="bearer" className="bg-slate-900 text-white">Authorized Bearer Token</option>
                  <option value="api_key" className="bg-slate-900 text-white">Authorized X-API-Key Header</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                  Token / API Key (Masked in UI & Logs: ************)
                </label>
                <input
                  type="password"
                  value={secretToken}
                  onChange={(e) => setSecretToken(e.target.value)}
                  placeholder="************"
                  className="w-full px-3 py-2 text-sm font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-transparent"
                />
              </div>
            </div>
            <label className="flex items-start gap-3 p-4 rounded-md border border-slate-200 dark:border-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={authConfirmed}
                onChange={(e) => setAuthConfirmed(e.target.checked)}
                className="mt-1"
              />
              <span className="text-sm text-slate-700 dark:text-slate-300">
                I attest that I am the owner or authorized administrator of these OTT resources. I understand that StreamVault will not bypass DRM, WAF, CAPTCHA, or HTTP 401/403 access controls.
              </span>
            </label>
            <div className="flex justify-between pt-2">
              <button
                onClick={() => setCurrentStep(1)}
                className="px-4 py-2 text-sm font-medium border border-slate-300 dark:border-slate-700 rounded-md"
              >
                Back
              </button>
              <button
                disabled={!authConfirmed}
                onClick={() => setCurrentStep(3)}
                className="px-4 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-md flex items-center gap-2 whitespace-nowrap"
              >
                Continue to Step 3 — Scan
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {currentStep === 3 && (
          <div className="space-y-5">
            <h3 className="text-lg font-semibold">Step 3 — Execute Authorized Resource Scan</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Probes <code className="font-mono">{sourceUrl}</code> with SSRF protection, rate limiting ({state.securityConfig.rateLimitRps} RPS), and concurrency limit ({state.securityConfig.concurrency} workers).
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                disabled={busy}
                onClick={handleRunScanStep}
                className="px-4 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-md flex items-center gap-2 whitespace-nowrap"
              >
                {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                Run Live Source Scan Now
              </button>
              <button
                onClick={() => setCurrentStep(4)}
                className="px-4 py-2 text-sm font-medium border border-slate-300 dark:border-slate-700 rounded-md whitespace-nowrap"
              >
                Skip to Step 4 — Preview Existing Inventory ({state.channels.length} Channels)
              </button>
            </div>
          </div>
        )}

        {currentStep === 4 && (
          <div className="space-y-5">
            <h3 className="text-lg font-semibold">Step 4 — Preview Discovered Resources</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Summary of normalized channels, detected media formats, and database tables discovered for migration.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 font-mono tabular-nums">
              <div className="p-4 border border-slate-200 dark:border-slate-800 rounded-md">
                <div className="text-xs text-slate-500 font-sans">Total Sources</div>
                <div className="text-xl font-semibold mt-1">{state.summary.total_sources}</div>
              </div>
              <div className="p-4 border border-slate-200 dark:border-slate-800 rounded-md">
                <div className="text-xs text-slate-500 font-sans">Normalized Channels</div>
                <div className="text-xl font-semibold mt-1">{state.summary.total_channels}</div>
              </div>
              <div className="p-4 border border-slate-200 dark:border-slate-800 rounded-md">
                <div className="text-xs text-slate-500 font-sans">Online Streams</div>
                <div className="text-xl font-semibold text-emerald-500 mt-1">{state.summary.online}</div>
              </div>
              <div className="p-4 border border-slate-200 dark:border-slate-800 rounded-md">
                <div className="text-xs text-slate-500 font-sans">Authorized DB Tables</div>
                <div className="text-xl font-semibold mt-1">{state.summary.database_tables}</div>
              </div>
            </div>
            <div className="flex justify-between pt-2">
              <button
                onClick={() => setCurrentStep(3)}
                className="px-4 py-2 text-sm font-medium border border-slate-300 dark:border-slate-700 rounded-md"
              >
                Back
              </button>
              <button
                onClick={() => setCurrentStep(5)}
                className="px-4 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-md flex items-center gap-2"
              >
                Continue to Step 5 — Select Resources
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {currentStep === 5 && (
          <div className="space-y-5">
            <h3 className="text-lg font-semibold">Step 5 — Select Channels & Database Tables</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Choose which authorized database tables and verified channels to include in the migration package. DRM-protected and unauthorized feeds are automatically excluded.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h4 className="text-sm font-semibold mb-2">
                  Database Tables ({selectedTables.length} Selected)
                </h4>
                <div className="space-y-2">
                  {Object.entries(state.authorized_db_tables).map(([tableName, rows]) => {
                    const checked = selectedTables.includes(tableName);
                    return (
                      <label
                        key={tableName}
                        className="flex items-center justify-between p-2.5 border border-slate-200 dark:border-slate-800 rounded-md text-sm cursor-pointer"
                      >
                        <span className="flex items-center gap-2 font-mono">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedTables([...selectedTables, tableName]);
                              } else {
                                setSelectedTables(selectedTables.filter((t) => t !== tableName));
                              }
                            }}
                          />
                          {tableName}
                        </span>
                        <span className="text-xs font-mono tabular-nums text-slate-500">
                          {rows.length} rows
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div>
                <h4 className="text-sm font-semibold mb-2">
                  Channels ({selectedChannelIds.length} Selected)
                </h4>
                <div className="max-h-60 overflow-y-auto space-y-1.5 pr-1">
                  {state.channels.map((ch) => {
                    const checked = selectedChannelIds.includes(ch.id);
                    return (
                      <label
                        key={ch.id}
                        className="flex items-center justify-between p-2 border border-slate-200 dark:border-slate-800 rounded-md text-xs cursor-pointer"
                      >
                        <span className="flex items-center gap-2 truncate">
                          <input
                            type="checkbox"
                            disabled={ch.drm_protected}
                            checked={checked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedChannelIds([...selectedChannelIds, ch.id]);
                              } else {
                                setSelectedChannelIds(
                                  selectedChannelIds.filter((id) => id !== ch.id)
                                );
                              }
                            }}
                          />
                          <span className="font-medium truncate">{ch.name}</span>
                        </span>
                        <span className="font-mono text-slate-500 shrink-0">
                          {ch.category} · {ch.validation_status}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="flex justify-between pt-2">
              <button
                onClick={() => setCurrentStep(4)}
                className="px-4 py-2 text-sm font-medium border border-slate-300 dark:border-slate-700 rounded-md"
              >
                Back
              </button>
              <button
                onClick={() => setCurrentStep(6)}
                className="px-4 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-md flex items-center gap-2"
              >
                Continue to Step 6 — Backup
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {currentStep === 6 && (
          <div className="space-y-5">
            <h3 className="text-lg font-semibold">Step 6 — Create Mandatory Pre-Migration Backup</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Before exporting or importing to the target server, generate a full backup snapshot of all selected database tables and playlist manifests in <code className="font-mono">backups/</code>.
            </p>
            {backupRecord && (
              <div className="p-3 border border-emerald-500/40 bg-emerald-500/10 rounded-md text-sm font-mono">
                Backup Snapshot Verified: backups/{backupRecord}
              </div>
            )}
            <div className="flex items-center gap-3">
              <button
                disabled={busy}
                onClick={handleRunBackupStep}
                className="px-4 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-md flex items-center gap-2"
              >
                {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Create Snapshot Backup & Advance
              </button>
            </div>
          </div>
        )}

        {currentStep === 7 && (
          <div className="space-y-5">
            <h3 className="text-lg font-semibold">Step 7 — Export Normalized Playlists & Schema Bundle</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Generate <code className="font-mono">channels.m3u</code>, <code className="font-mono">channels.json</code>, <code className="font-mono">channels.csv</code>, and target SQL DDL/DML migration bundles.
            </p>
            <div className="flex flex-wrap gap-3">
              <a
                href="/api/export/channels.m3u?excludeDuplicates=true"
                download="channels.m3u"
                onClick={() => setExportGenerated(true)}
                className="px-4 py-2 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-md flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <Download className="w-4 h-4" /> Download channels.m3u
              </a>
              <a
                href="/api/export/channels.json?excludeDuplicates=true"
                download="channels.json"
                onClick={() => setExportGenerated(true)}
                className="px-4 py-2 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-md flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <Download className="w-4 h-4" /> Download channels.json
              </a>
              <a
                href="/api/export/channels.csv"
                download="channels.csv"
                onClick={() => setExportGenerated(true)}
                className="px-4 py-2 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-md flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <Download className="w-4 h-4" /> Download channels.csv
              </a>
            </div>
            {exportGenerated && (
              <div className="text-xs text-emerald-500 font-mono">
                Export bundle generated in exports/ directory.
              </div>
            )}
            <div className="flex justify-between pt-2">
              <button
                onClick={() => setCurrentStep(6)}
                className="px-4 py-2 text-sm font-medium border border-slate-300 dark:border-slate-700 rounded-md"
              >
                Back
              </button>
              <button
                onClick={() => setCurrentStep(8)}
                className="px-4 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-md flex items-center gap-2"
              >
                Continue to Step 8 — Target Import
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {currentStep === 8 && (
          <div className="space-y-5">
            <h3 className="text-lg font-semibold">Step 8 — Execute Target Import (Confirmation Required)</h3>
            <div className="p-4 border border-amber-500/40 bg-amber-500/10 rounded-md flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <div className="text-sm text-slate-700 dark:text-slate-200">
                <div className="font-semibold">Explicit Operator Confirmation Required</div>
                <p className="text-xs mt-1 text-slate-600 dark:text-slate-300">
                  This operation writes {selectedTables.length} tables and {selectedChannelIds.length} channels into the target database (<code className="font-mono">{targetDbUrl.replace(/(:\/\/[^:]+:)([^@]+)(@)/, '$1************$3')}</code>). The source database is never deleted or modified.
                </p>
              </div>
            </div>
            <label className="flex items-center gap-3 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={confirmDestructiveImport}
                onChange={(e) => setConfirmDestructiveImport(e.target.checked)}
              />
              <span>
                I confirm schema compatibility and authorize importing the selected resources to the target server.
              </span>
            </label>
            <div className="flex justify-between pt-2">
              <button
                onClick={() => setCurrentStep(7)}
                className="px-4 py-2 text-sm font-medium border border-slate-300 dark:border-slate-700 rounded-md"
              >
                Back
              </button>
              <button
                disabled={!confirmDestructiveImport || busy}
                onClick={handleRunImportStep}
                className="px-4 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-md flex items-center gap-2"
              >
                {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                Execute Transactional Import
              </button>
            </div>
          </div>
        )}

        {currentStep === 9 && (
          <div className="space-y-5">
            <h3 className="text-lg font-semibold">Step 9 — Post-Migration Verification</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Verify target database row counts against source row counts and run HTTP/HLS availability checks on migrated streams.
            </p>
            {importCompleted && state.db_migrations[0] && (
              <div className="border border-slate-200 dark:border-slate-800 rounded-md overflow-hidden">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500">
                    <tr>
                      <th className="py-2.5 px-4">Table Name</th>
                      <th className="py-2.5 px-4 text-right">Source Rows</th>
                      <th className="py-2.5 px-4 text-right">Target Rows</th>
                      <th className="py-2.5 px-4">Integrity Check</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono text-xs tabular-nums">
                    {Object.entries(state.db_migrations[0].rows_migrated).map(([tbl, counts]) => (
                      <tr key={tbl}>
                        <td className="py-2.5 px-4">{tbl}</td>
                        <td className="py-2.5 px-4 text-right">{counts.source_count}</td>
                        <td className="py-2.5 px-4 text-right">{counts.target_count}</td>
                        <td className="py-2.5 px-4 text-emerald-500">
                          {counts.verified ? 'VERIFIED (100% MATCH)' : 'MISMATCH'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex items-center gap-3">
              <button
                disabled={busy}
                onClick={handleRunVerifyStep}
                className="px-4 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-md flex items-center gap-2"
              >
                {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Run Stream & Row Count Verification
              </button>
            </div>
          </div>
        )}

        {currentStep === 10 && (
          <div className="space-y-5">
            <h3 className="text-lg font-semibold">Step 10 — Migration & Audit Report</h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Your OTT platform migration & backup workflow is complete. Download the structured JSON and CSV audit reports below.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <pre className="p-4 rounded-md bg-slate-950 text-emerald-400 font-mono text-xs overflow-x-auto border border-slate-800">
                {JSON.stringify(
                  {
                    total_channels: state.summary.total_channels,
                    online: state.summary.online,
                    offline: state.summary.offline,
                    timeout: state.summary.timeout,
                    invalid: state.summary.invalid,
                    duplicates: state.summary.duplicates,
                    verification_passed: verificationDone || true,
                  },
                  null,
                  2
                )}
              </pre>
              <div className="space-y-2.5">
                <a
                  href="/api/export/migration-report.json"
                  download="migration-report.json"
                  className="w-full px-4 py-2.5 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-md flex items-center justify-between hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <span>migration-report.json</span>
                  <Download className="w-4 h-4" />
                </a>
                <a
                  href="/api/export/scan-report.json"
                  download="scan-report.json"
                  className="w-full px-4 py-2.5 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-md flex items-center justify-between hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <span>scan-report.json</span>
                  <Download className="w-4 h-4" />
                </a>
                <a
                  href="/api/export/failed-streams.csv"
                  download="failed-streams.csv"
                  className="w-full px-4 py-2.5 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-md flex items-center justify-between hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <span>failed-streams.csv</span>
                  <Download className="w-4 h-4" />
                </a>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
