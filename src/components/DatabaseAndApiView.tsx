import React, { useState } from 'react';
import {
  CheckCircle2,
  Database,
  FileCode2,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldAlert,
} from 'lucide-react';
import { AppStateResponse, DatabaseTableSchema } from '../types.ts';

interface Props {
  state: AppStateResponse;
  onRefresh: () => Promise<void>;
  notify: (msg: string, type?: 'success' | 'error') => void;
}

export const DatabaseAndApiView: React.FC<Props> = ({ state, onRefresh, notify }) => {
  const [subTab, setSubTab] = useState<'database' | 'api'>('database');

  // Database state
  const [sourceConnUrl, setSourceConnUrl] = useState<string>(
    'sqlite:///./data/authorized_source_ott.db'
  );
  const [targetConnUrl, setTargetConnUrl] = useState<string>(
    'postgresql://ott_admin:secret_pass@db-target.internal:5432/ott_prod'
  );
  const [targetDialect, setTargetDialect] = useState<'postgresql' | 'mysql' | 'sqlite'>(
    'postgresql'
  );
  const [inspectedTables, setInspectedTables] = useState<DatabaseTableSchema[]>([]);
  const [selectedTables, setSelectedTables] = useState<string[]>([
    'ott_categories',
    'ott_channels',
    'ott_epg_sources',
    'ott_transcode_profiles',
    'ott_cdn_origins',
  ]);
  const [generatedSql, setGeneratedSql] = useState<string>('');
  const [confirmMigration, setConfirmMigration] = useState<boolean>(false);
  const [dbBusy, setDbBusy] = useState<boolean>(false);

  // API Migration state
  const [apiBaseUrl, setApiBaseUrl] = useState<string>('https://api.authorized-ott.internal');
  const [apiEndpoint, setApiEndpoint] = useState<string>('/v1/channels.json');
  const [apiMethod, setApiMethod] = useState<'GET' | 'POST'>('GET');
  const [apiFormat, setApiFormat] = useState<'JSON' | 'XML'>('JSON');
  const [apiAuthMethod, setApiAuthMethod] = useState<'none' | 'api_key' | 'bearer'>('bearer');
  const [apiSecret, setApiSecret] = useState<string>('live_ott_token_998877');
  const [apiStartPage, setApiStartPage] = useState<number>(1);
  const [apiMaxPages, setApiMaxPages] = useState<number>(3);
  const [apiRateLimit, setApiRateLimit] = useState<number>(5);
  const [apiBusy, setApiBusy] = useState<boolean>(false);

  const handleInspectSchema = async () => {
    setDbBusy(true);
    try {
      const res = await fetch('/api/db/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionUrl: sourceConnUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Schema inspection failed');
      setInspectedTables(data.tables || []);
      await onRefresh();
      notify(
        `Inspected ${data.total_tables} tables (${data.total_rows} rows) on ${data.dialect}. Sensitive fields masked.`
      );
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Schema inspection error', 'error');
    } finally {
      setDbBusy(false);
    }
  };

  const handleBackupDb = async () => {
    setDbBusy(true);
    try {
      const res = await fetch('/api/db/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionUrl: sourceConnUrl, selectedTables }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Database backup failed');
      await onRefresh();
      notify(`Created database backup: backups/${data.backup_file} (${data.total_rows} rows).`);
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Backup error', 'error');
    } finally {
      setDbBusy(false);
    }
  };

  const handleRestoreDb = async () => {
    setDbBusy(true);
    try {
      const res = await fetch('/api/db/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Database restore failed');
      await onRefresh();
      notify(`Restored ${data.rows_restored} rows from ${data.restored_from}.`);
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Restore error', 'error');
    } finally {
      setDbBusy(false);
    }
  };

  const handleGenerateMigrationSql = async () => {
    setDbBusy(true);
    try {
      const res = await fetch('/api/db/generate-sql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetDialect, selectedTables }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate SQL');
      setGeneratedSql(data.sql || '');
      notify(`Generated ${data.dialect.toUpperCase()} migration script: exports/${data.filename}`);
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'SQL generation error', 'error');
    } finally {
      setDbBusy(false);
    }
  };

  const handleExecuteMigration = async () => {
    if (!confirmMigration) {
      notify('Please check the explicit operator confirmation checkbox before migrating.', 'error');
      return;
    }
    setDbBusy(true);
    try {
      const res = await fetch('/api/db/migrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceConnectionUrl: sourceConnUrl,
          targetConnectionUrl: targetConnUrl,
          selectedTables,
          confirmed: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Migration failed');
      await onRefresh();
      notify(
        `Completed 9-step database migration (${data.selected_tables.length} tables verified).`
      );
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'Migration error', 'error');
    } finally {
      setDbBusy(false);
    }
  };

  const handleRunApiMigration = async () => {
    setApiBusy(true);
    try {
      const res = await fetch('/api/api-migration/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseUrl: apiBaseUrl,
          endpoint: apiEndpoint,
          method: apiMethod,
          format: apiFormat,
          authMethod: apiAuthMethod,
          apiKey: apiAuthMethod === 'api_key' ? apiSecret : undefined,
          bearerToken: apiAuthMethod === 'bearer' ? apiSecret : undefined,
          startPage: apiStartPage,
          maxPages: apiMaxPages,
          rateLimitRps: apiRateLimit,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'API Migration failed');
      await onRefresh();
      notify(
        `API Migration complete: Fetched ${data.job.pages_fetched} pages, imported ${data.job.channels_imported} channels. Credentials masked: ************`
      );
    } catch (err: unknown) {
      notify(err instanceof Error ? err.message : 'API Migration error', 'error');
    } finally {
      setApiBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Segmented Control */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-4">
        <button
          onClick={() => setSubTab('database')}
          className={`px-4 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
            subTab === 'database'
              ? 'bg-emerald-600 text-white'
              : 'border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          Authorized Database Migration (PostgreSQL · MySQL/MariaDB · SQLite)
        </button>
        <button
          onClick={() => setSubTab('api')}
          className={`px-4 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
            subTab === 'api'
              ? 'bg-emerald-600 text-white'
              : 'border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          Authorized API Migration (GET/POST · JSON/XML · Paginated)
        </button>
      </div>

      {subTab === 'database' ? (
        <div className="space-y-6">
          <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 rounded-lg space-y-5">
            <div>
              <h2 className="text-lg font-semibold">
                Authorized Relational Database Schema Inspector & Migrator
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Supports PostgreSQL, MySQL/MariaDB, and SQLite. Sensitive fields (passwords, tokens, API keys) are automatically masked as <code className="font-mono">************</code>.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Source Database Connection URI
                </label>
                <input
                  type="text"
                  value={sourceConnUrl}
                  onChange={(e) => setSourceConnUrl(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-transparent"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Target Database Connection URI
                </label>
                <input
                  type="text"
                  value={targetConnUrl}
                  onChange={(e) => setTargetConnUrl(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-transparent"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Target SQL Dialect
                </label>
                <select
                  value={targetDialect}
                  onChange={(e) => setTargetDialect(e.target.value as typeof targetDialect)}
                  className="w-full px-3 py-2 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-transparent"
                >
                  <option value="postgresql" className="bg-slate-900 text-white">PostgreSQL</option>
                  <option value="mysql" className="bg-slate-900 text-white">MySQL / MariaDB</option>
                  <option value="sqlite" className="bg-slate-900 text-white">SQLite</option>
                </select>
              </div>
            </div>

            {/* 5 Core Database Operations */}
            <div className="flex flex-wrap gap-2.5 pt-1">
              <button
                disabled={dbBusy}
                onClick={handleInspectSchema}
                className="px-3.5 py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-md flex items-center gap-2 whitespace-nowrap"
              >
                <Database className="w-3.5 h-3.5" />
                1–4. Inspect Schema (Tables, Rows & Relationships)
              </button>
              <button
                disabled={dbBusy}
                onClick={handleBackupDb}
                className="px-3.5 py-2 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-md flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
              >
                <Save className="w-3.5 h-3.5" />
                Backup Database
              </button>
              <button
                disabled={dbBusy}
                onClick={handleRestoreDb}
                className="px-3.5 py-2 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-md flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Restore Database
              </button>
              <button
                disabled={dbBusy}
                onClick={handleGenerateMigrationSql}
                className="px-3.5 py-2 text-xs font-medium border border-slate-300 dark:border-slate-700 rounded-md flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
              >
                <FileCode2 className="w-3.5 h-3.5" />
                Generate Migration SQL (Export Database)
              </button>
            </div>

            {/* Table Selection & Relationships Grid */}
            <div className="border border-slate-200 dark:border-slate-800 rounded-md overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-500">
                  <tr>
                    <th className="py-2.5 px-3">Migrate</th>
                    <th className="py-2.5 px-3">Table Name</th>
                    <th className="py-2.5 px-3 text-right">Source Rows</th>
                    <th className="py-2.5 px-3 text-right">Target Rows</th>
                    <th className="py-2.5 px-3">Foreign Key Relationships</th>
                    <th className="py-2.5 px-3">Sensitive Field Protection</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800 font-mono tabular-nums">
                  {Object.entries(state.authorized_db_tables).map(([tableName, rows]) => {
                    const checked = selectedTables.includes(tableName);
                    const targetCount = (state.target_db_tables[tableName] || []).length;
                    const schemaInfo = inspectedTables.find((t) => t.table_name === tableName);
                    const relText =
                      schemaInfo && schemaInfo.relationships.length > 0
                        ? schemaInfo.relationships
                            .map((r) => `${r.column} → ${r.references_table}.${r.references_column}`)
                            .join(', ')
                        : tableName === 'ott_channels'
                        ? 'category_id → ott_categories.id'
                        : tableName === 'ott_epg_sources'
                        ? 'channel_id → ott_channels.id'
                        : 'Root Entity';
                    const sampleKeys = Object.keys(rows[0] || {});
                    const sensitiveCols = sampleKeys.filter((k) =>
                      /secret|token|password|key/i.test(k)
                    );

                    return (
                      <tr key={tableName} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="py-2.5 px-3">
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
                        </td>
                        <td className="py-2.5 px-3 font-semibold">{tableName}</td>
                        <td className="py-2.5 px-3 text-right">{rows.length}</td>
                        <td className="py-2.5 px-3 text-right">{targetCount}</td>
                        <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400">{relText}</td>
                        <td className="py-2.5 px-3 text-emerald-500">
                          {sensitiveCols.length > 0
                            ? `${sensitiveCols.join(', ')} (************)`
                            : 'Verified Clean'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Confirmation & Execute Migration */}
            <div className="p-4 border border-slate-200 dark:border-slate-800 rounded-md flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <label className="flex items-center gap-2.5 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmMigration}
                  onChange={(e) => setConfirmMigration(e.target.checked)}
                />
                <span>
                  I confirm pre-migration backup creation, schema compatibility check, and row-count verification for the {selectedTables.length} selected tables.
                </span>
              </label>
              <button
                disabled={!confirmMigration || dbBusy}
                onClick={handleExecuteMigration}
                className="px-4 py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-md flex items-center gap-2 whitespace-nowrap"
              >
                {dbBusy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Import Database (Run 9-Step Migration)
              </button>
            </div>

            {generatedSql && (
              <div>
                <div className="text-xs font-semibold mb-1.5">
                  Generated SQL DDL/DML Migration Preview ({targetDialect.toUpperCase()})
                </div>
                <pre className="p-4 rounded-md bg-slate-950 text-emerald-400 font-mono text-xs max-h-60 overflow-y-auto border border-slate-800">
                  {generatedSql}
                </pre>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 rounded-lg space-y-5">
          <div>
            <h2 className="text-lg font-semibold">Authorized API Migration (JSON / XML)</h2>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Migrates channel records across paginated APIs (<code className="font-mono">page=1, 2, 3...</code>) using GET or explicitly configured POST requests. Never brute-forces undocumented endpoints.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Base URL
              </label>
              <input
                type="text"
                value={apiBaseUrl}
                onChange={(e) => setApiBaseUrl(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-transparent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                API Endpoint Path
              </label>
              <input
                type="text"
                value={apiEndpoint}
                onChange={(e) => setApiEndpoint(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-transparent"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  HTTP Method
                </label>
                <select
                  value={apiMethod}
                  onChange={(e) => setApiMethod(e.target.value as 'GET' | 'POST')}
                  className="w-full px-3 py-2 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-transparent"
                >
                  <option value="GET" className="bg-slate-900 text-white">GET</option>
                  <option value="POST" className="bg-slate-900 text-white">POST (Explicit)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Payload Format
                </label>
                <select
                  value={apiFormat}
                  onChange={(e) => setApiFormat(e.target.value as 'JSON' | 'XML')}
                  className="w-full px-3 py-2 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-transparent"
                >
                  <option value="JSON" className="bg-slate-900 text-white">JSON</option>
                  <option value="XML" className="bg-slate-900 text-white">XML</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Authentication Method
              </label>
              <select
                value={apiAuthMethod}
                onChange={(e) => setApiAuthMethod(e.target.value as typeof apiAuthMethod)}
                className="w-full px-3 py-2 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-transparent"
              >
                <option value="bearer" className="bg-slate-900 text-white">Bearer Token</option>
                <option value="api_key" className="bg-slate-900 text-white">API Key (X-API-Key)</option>
                <option value="none" className="bg-slate-900 text-white">None</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                API Key / Bearer Token (Masked as ************)
              </label>
              <input
                type="password"
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-transparent"
              />
            </div>
            <div className="grid grid-cols-3 gap-2 font-mono tabular-nums">
              <div>
                <label className="block text-xs font-sans font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Start Page
                </label>
                <input
                  type="number"
                  min={1}
                  value={apiStartPage}
                  onChange={(e) => setApiStartPage(Number(e.target.value) || 1)}
                  className="w-full px-2.5 py-2 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-transparent"
                />
              </div>
              <div>
                <label className="block text-xs font-sans font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Max Pages
                </label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={apiMaxPages}
                  onChange={(e) => setApiMaxPages(Number(e.target.value) || 3)}
                  className="w-full px-2.5 py-2 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-transparent"
                />
              </div>
              <div>
                <label className="block text-xs font-sans font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Rate (RPS)
                </label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={apiRateLimit}
                  onChange={(e) => setApiRateLimit(Number(e.target.value) || 5)}
                  className="w-full px-2.5 py-2 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-transparent"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <div className="text-xs font-mono text-slate-500">
              Pagination preview: {apiEndpoint}?page={apiStartPage} → page={apiStartPage + apiMaxPages - 1} · Masked secret: ************
            </div>
            <button
              disabled={apiBusy}
              onClick={handleRunApiMigration}
              className="px-4 py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-md flex items-center gap-2 whitespace-nowrap"
            >
              {apiBusy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              Run Paginated API Migration
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
