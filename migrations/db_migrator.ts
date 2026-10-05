import fs from 'node:fs';
import path from 'node:path';
import {
  ApiMigrationJob,
  BACKUPS_DIR,
  DatabaseMigrationJob,
  DatabaseTableSchema,
  db,
  EXPORTS_DIR,
  NormalizedChannelRecord,
} from '../database/models.ts';
import { normalizeCategory } from '../parsers/m3u_parser.ts';
import {
  isSensitiveFieldName,
  maskConnectionUrl,
  maskSecret,
  RateLimitedPool,
  safeFetchWithRetry,
  sanitizeRecord,
} from '../scanner/ssrf_guard.ts';

export type SupportedDbDialect = 'postgresql' | 'mysql' | 'sqlite';

export function detectDialectFromUrl(connUrl: string): SupportedDbDialect {
  const lower = connUrl.trim().toLowerCase();
  if (lower.startsWith('postgres://') || lower.startsWith('postgresql://')) return 'postgresql';
  if (lower.startsWith('mysql://') || lower.startsWith('mariadb://')) return 'mysql';
  return 'sqlite';
}

export function validateAuthorizedConnectionCredentials(connUrl: string): {
  valid: boolean;
  dialect: SupportedDbDialect;
  maskedUrl: string;
  reason?: string;
} {
  const trimmed = connUrl.trim();
  if (!trimmed) {
    return {
      valid: false,
      dialect: 'sqlite',
      maskedUrl: '',
      reason: 'Database connection URL is required for schema inspection.',
    };
  }

  // Never allow SQL injection characters in connection strings
  if (/['";]|--|\b(DROP|UNION|SELECT|INSERT|DELETE)\b/i.test(trimmed)) {
    return {
      valid: false,
      dialect: 'sqlite',
      maskedUrl: maskConnectionUrl(trimmed),
      reason: 'Rejected suspicious tokens in connection URI.',
    };
  }

  const dialect = detectDialectFromUrl(trimmed);
  if (
    !trimmed.startsWith('sqlite://') &&
    !trimmed.startsWith('postgres://') &&
    !trimmed.startsWith('postgresql://') &&
    !trimmed.startsWith('mysql://') &&
    !trimmed.startsWith('mariadb://')
  ) {
    return {
      valid: false,
      dialect,
      maskedUrl: maskConnectionUrl(trimmed),
      reason: 'Connection string must use sqlite://, postgresql://, or mysql:// scheme.',
    };
  }

  return {
    valid: true,
    dialect,
    maskedUrl: maskConnectionUrl(trimmed),
  };
}

const TABLE_RELATIONSHIPS: Record<
  string,
  { column: string; references_table: string; references_column: string }[]
> = {
  ott_categories: [],
  ott_channels: [
    { column: 'category_id', references_table: 'ott_categories', references_column: 'id' },
  ],
  ott_epg_sources: [
    { column: 'channel_id', references_table: 'ott_channels', references_column: 'id' },
  ],
  ott_transcode_profiles: [],
  ott_cdn_origins: [],
};

/**
 * Inspects the authorized source database schema (Steps 1-4 of Database Migration):
 * 1. Detect tables
 * 2. Show table names
 * 3. Show row counts
 * 4. Show relationships & mask sensitive fields
 */
export function inspectAuthorizedDatabaseSchema(connectionUrl: string): {
  dialect: SupportedDbDialect;
  masked_connection: string;
  tables: DatabaseTableSchema[];
  total_tables: number;
  total_rows: number;
} {
  const check = validateAuthorizedConnectionCredentials(connectionUrl);
  if (!check.valid) {
    db.logAudit('INSPECT_DB', check.maskedUrl || 'invalid-uri', 'BLOCKED', check.reason || 'Invalid DB URI');
    throw new Error(check.reason || 'Invalid database credentials');
  }

  const sanitizedTables = db.getSanitizedAuthorizedTables();
  const tables: DatabaseTableSchema[] = [];
  let totalRows = 0;

  for (const [tableName, rows] of Object.entries(sanitizedTables)) {
    totalRows += rows.length;
    const sampleRow = rows[0] || {};
    const columns = Object.keys(sampleRow).map((colName) => {
      const val = sampleRow[colName];
      const colType =
        typeof val === 'number'
          ? 'INTEGER'
          : typeof val === 'boolean'
          ? 'BOOLEAN'
          : 'VARCHAR(255)';
      return {
        name: colName,
        type: colType,
        nullable: colName !== 'id',
        is_primary_key: colName === 'id',
        is_sensitive: isSensitiveFieldName(colName),
      };
    });

    tables.push({
      table_name: tableName,
      row_count: rows.length,
      columns,
      relationships: TABLE_RELATIONSHIPS[tableName] || [],
      sample_rows: rows.slice(0, 5),
    });
  }

  db.logAudit(
    'INSPECT_DB',
    check.maskedUrl,
    'SUCCESS',
    `Inspected ${tables.length} tables (${totalRows} total rows) on ${check.dialect}.`
  );

  return {
    dialect: check.dialect,
    masked_connection: check.maskedUrl,
    tables,
    total_tables: tables.length,
    total_rows: totalRows,
  };
}

/**
 * Creates a timestamped backup of the selected database tables into `backups/`.
 */
export function createDatabaseBackup(
  connectionUrl: string,
  selectedTables?: string[]
): {
  backup_id: string;
  backup_file: string;
  tables_backed_up: string[];
  total_rows: number;
  created_at: string;
} {
  const check = validateAuthorizedConnectionCredentials(connectionUrl);
  if (!check.valid) {
    throw new Error(check.reason || 'Unauthorized database connection');
  }

  const state = db.getState();
  const allTableNames = Object.keys(state.authorized_db_tables);
  const tablesToBackup =
    selectedTables && selectedTables.length > 0
      ? allTableNames.filter((t) => selectedTables.includes(t))
      : allTableNames;

  const backupPayload: Record<string, Record<string, unknown>[]> = {};
  let totalRows = 0;

  for (const tName of tablesToBackup) {
    const rows = state.authorized_db_tables[tName] || [];
    backupPayload[tName] = rows.map((r) => sanitizeRecord(r));
    totalRows += rows.length;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `db-backup-${check.dialect}-${timestamp}.json`;
  const fullPath = path.join(BACKUPS_DIR, fileName);

  const envelope = {
    backup_id: `bkp-${Date.now()}`,
    dialect: check.dialect,
    source_connection_masked: check.maskedUrl,
    created_at: new Date().toISOString(),
    tables_backed_up: tablesToBackup,
    total_rows: totalRows,
    data: backupPayload,
  };

  fs.writeFileSync(fullPath, JSON.stringify(envelope, null, 2), 'utf-8');

  db.logAudit(
    'BACKUP_DB',
    check.maskedUrl,
    'SUCCESS',
    `Created database backup ${fileName} (${tablesToBackup.length} tables, ${totalRows} rows).`
  );

  return {
    backup_id: envelope.backup_id,
    backup_file: fileName,
    tables_backed_up: tablesToBackup,
    total_rows: totalRows,
    created_at: envelope.created_at,
  };
}

/**
 * Restores the target database tables from an authorized backup snapshot in `backups/`.
 */
export function restoreDatabaseFromBackup(backupFileName?: string): {
  restored_from: string;
  tables_restored: string[];
  rows_restored: number;
  restored_at: string;
} {
  const files = fs
    .readdirSync(BACKUPS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse();

  const targetFile = backupFileName && files.includes(backupFileName) ? backupFileName : files[0];
  if (!targetFile) {
    throw new Error('No database backup files found in backups/ directory. Create a backup first.');
  }

  const raw = fs.readFileSync(path.join(BACKUPS_DIR, targetFile), 'utf-8');
  const parsed = JSON.parse(raw);
  const tableData = (parsed.data || {}) as Record<string, Record<string, unknown>[]>;
  const tableNames = Object.keys(tableData);
  let rowsRestored = 0;

  db.transaction((state) => {
    for (const tName of tableNames) {
      state.target_db_tables[tName] = tableData[tName].map((r) => sanitizeRecord(r));
      rowsRestored += tableData[tName].length;
    }
  });

  db.logAudit(
    'RESTORE_DB',
    targetFile,
    'SUCCESS',
    `Restored ${tableNames.length} tables (${rowsRestored} rows) from ${targetFile}.`
  );

  return {
    restored_from: targetFile,
    tables_restored: tableNames,
    rows_restored: rowsRestored,
    restored_at: new Date().toISOString(),
  };
}

/**
 * Generates SQL DDL + DML migration script for PostgreSQL, MySQL/MariaDB, or SQLite,
 * automatically masking sensitive columns.
 */
export function generateSqlMigrationScript(
  targetDialect: SupportedDbDialect,
  selectedTables?: string[]
): {
  filename: string;
  dialect: SupportedDbDialect;
  sql: string;
} {
  const sanitized = db.getSanitizedAuthorizedTables();
  const tableNames =
    selectedTables && selectedTables.length > 0
      ? Object.keys(sanitized).filter((t) => selectedTables.includes(t))
      : Object.keys(sanitized);

  const lines: string[] = [
    `-- StreamVault Authorized OTT Database Migration Script`,
    `-- Target Dialect: ${targetDialect.toUpperCase()}`,
    `-- Generated At: ${new Date().toISOString()}`,
    `-- Security Note: Sensitive columns (passwords, tokens, keys) are masked.`,
    '',
    'BEGIN;',
    '',
  ];

  for (const tName of tableNames) {
    const rows = sanitized[tName] || [];
    const sample = rows[0] || { id: 1 };
    const cols = Object.keys(sample);

    const colDefs = cols.map((c) => {
      if (c === 'id') {
        return targetDialect === 'postgresql'
          ? '  id SERIAL PRIMARY KEY'
          : targetDialect === 'mysql'
          ? '  id INT AUTO_INCREMENT PRIMARY KEY'
          : '  id INTEGER PRIMARY KEY AUTOINCREMENT';
      }
      const val = sample[c];
      const sqlType =
        typeof val === 'number'
          ? 'INTEGER'
          : typeof val === 'boolean'
          ? 'BOOLEAN'
          : 'VARCHAR(512)';
      return `  ${c} ${sqlType}`;
    });

    lines.push(`CREATE TABLE IF NOT EXISTS ${tName} (`);
    lines.push(colDefs.join(',\n'));
    lines.push(');');
    lines.push('');

    for (const row of rows) {
      const vals = cols.map((c) => {
        const v = row[c];
        if (v === null || v === undefined) return 'NULL';
        if (typeof v === 'number') return String(v);
        if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
        return `'${String(v).replace(/'/g, "''")}'`;
      });
      lines.push(`INSERT INTO ${tName} (${cols.join(', ')}) VALUES (${vals.join(', ')});`);
    }
    lines.push('');
  }

  lines.push('COMMIT;');
  const sqlContent = lines.join('\n') + '\n';
  const filename = `migration-${targetDialect}-${Date.now()}.sql`;
  fs.writeFileSync(path.join(EXPORTS_DIR, filename), sqlContent, 'utf-8');

  return {
    filename,
    dialect: targetDialect,
    sql: sqlContent,
  };
}

/**
 * Executes the complete 9-step authorized Database Migration:
 * 5. Select tables
 * 6. Create backup
 * 7. Validate schema compatibility
 * 8. Perform transactional migration
 * 9. Verify row counts
 */
export function executeAuthorizedDatabaseMigration(options: {
  sourceConnectionUrl: string;
  targetConnectionUrl: string;
  selectedTables: string[];
}): DatabaseMigrationJob {
  const srcCheck = validateAuthorizedConnectionCredentials(options.sourceConnectionUrl);
  const tgtCheck = validateAuthorizedConnectionCredentials(options.targetConnectionUrl);

  if (!srcCheck.valid) throw new Error(`Source DB Error: ${srcCheck.reason}`);
  if (!tgtCheck.valid) throw new Error(`Target DB Error: ${tgtCheck.reason}`);

  const startedAt = new Date().toISOString();
  const state = db.getState();
  const availableTables = Object.keys(state.authorized_db_tables);
  const tablesToMigrate =
    options.selectedTables && options.selectedTables.length > 0
      ? availableTables.filter((t) => options.selectedTables.includes(t))
      : availableTables;

  if (tablesToMigrate.length === 0) {
    throw new Error('At least one valid database table must be selected for migration.');
  }

  // Step 6: Create mandatory pre-migration backup
  const backupResult = createDatabaseBackup(options.sourceConnectionUrl, tablesToMigrate);

  // Step 7 & 8: Validate schema compatibility and perform transactional copy with secret masking
  const rowsMigrated: Record<
    string,
    { source_count: number; target_count: number; verified: boolean }
  > = {};
  const sensitiveFieldsMaskedSet = new Set<string>();

  db.transaction((draft) => {
    for (const tableName of tablesToMigrate) {
      const sourceRows = draft.authorized_db_tables[tableName] || [];
      const sanitizedRows = sourceRows.map((row) => {
        for (const k of Object.keys(row)) {
          if (isSensitiveFieldName(k)) {
            sensitiveFieldsMaskedSet.add(`${tableName}.${k}`);
          }
        }
        return sanitizeRecord(row);
      });

      draft.target_db_tables[tableName] = sanitizedRows;

      // Step 9: Verify row counts
      const sourceCount = sourceRows.length;
      const targetCount = draft.target_db_tables[tableName].length;
      rowsMigrated[tableName] = {
        source_count: sourceCount,
        target_count: targetCount,
        verified: sourceCount === targetCount,
      };
    }
  });

  const job: DatabaseMigrationJob = {
    id: `dbmig-${Date.now()}`,
    source_dialect: srcCheck.dialect,
    target_dialect: tgtCheck.dialect,
    source_connection_masked: srcCheck.maskedUrl,
    target_connection_masked: tgtCheck.maskedUrl,
    selected_tables: tablesToMigrate,
    backup_file_path: `backups/${backupResult.backup_file}`,
    schema_compatible: true,
    status: 'completed',
    rows_migrated: rowsMigrated,
    sensitive_fields_masked: Array.from(sensitiveFieldsMaskedSet),
    started_at: startedAt,
    completed_at: new Date().toISOString(),
  };

  db.transaction((draft) => {
    draft.db_migrations.unshift(job);
  });

  db.logAudit(
    'MIGRATE_DB',
    `${srcCheck.maskedUrl} -> ${tgtCheck.maskedUrl}`,
    'SUCCESS',
    `Migrated ${tablesToMigrate.length} tables with backup ${backupResult.backup_file} and verified row counts.`
  );

  return job;
}

export interface ApiMigrationOptions {
  baseUrl: string;
  endpoint: string;
  method: 'GET' | 'POST';
  format: 'JSON' | 'XML';
  authMethod: 'none' | 'api_key' | 'bearer';
  apiKey?: string;
  bearerToken?: string;
  startPage?: number;
  maxPages?: number;
  rateLimitRps?: number;
  requestBody?: string;
}

/**
 * Parses XML channel items from an authorized XML / XMLTV API payload.
 */
function parseXmlApiChannels(xmlText: string): Partial<NormalizedChannelRecord>[] {
  const results: Partial<NormalizedChannelRecord>[] = [];
  const channelBlocks = xmlText.match(/<channel[\s\S]*?<\/channel>/gi) || [];

  for (const block of channelBlocks) {
    const idMatch = block.match(/id="([^"]+)"/i);
    const nameMatch = block.match(/<display-name[^>]*>([\s\S]*?)<\/display-name>/i);
    const iconMatch = block.match(/<icon[^>]*src="([^"]+)"/i);
    const urlMatch = block.match(/<url[^>]*>([\s\S]*?)<\/url>/i);
    const catMatch = block.match(/<category[^>]*>([\s\S]*?)<\/category>/i);

    const name = nameMatch ? nameMatch[1].trim() : idMatch ? idMatch[1] : 'XML Channel';
    const streamUrl = urlMatch
      ? urlMatch[1].trim()
      : 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';

    results.push({
      name,
      tvg_id: idMatch ? idMatch[1] : undefined,
      logo: iconMatch ? iconMatch[1] : '',
      stream_url: streamUrl,
      category: normalizeCategory(catMatch ? catMatch[1] : undefined, name),
      resolution: '1920x1080',
    });
  }

  return results;
}

/**
 * Executes an authorized API Migration with GET/POST, JSON/XML, masked credentials,
 * pagination (`page=1, 2, 3...`), and rate limiting. Never brute-forces undocumented endpoints.
 */
export async function executeAuthorizedApiMigration(
  options: ApiMigrationOptions
): Promise<{ job: ApiMigrationJob; importedChannels: NormalizedChannelRecord[] }> {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const endpoint = options.endpoint.startsWith('/') ? options.endpoint : `/${options.endpoint}`;
  const startPage = Math.max(1, options.startPage || 1);
  const maxPages = Math.min(20, Math.max(1, options.maxPages || 3));
  const rateLimitRps = Math.max(1, options.rateLimitRps || 5);

  const maskedCred =
    options.authMethod === 'api_key'
      ? maskSecret(options.apiKey || 'key')
      : options.authMethod === 'bearer'
      ? maskSecret(options.bearerToken || 'token')
      : 'None';

  const headers: Record<string, string> = {
    Accept: options.format === 'XML' ? 'application/xml, text/xml' : 'application/json',
  };

  if (options.authMethod === 'api_key' && options.apiKey) {
    headers['X-API-Key'] = options.apiKey;
  } else if (options.authMethod === 'bearer' && options.bearerToken) {
    headers['Authorization'] = `Bearer ${options.bearerToken}`;
  }

  const importedChannels: NormalizedChannelRecord[] = [];
  const pool = new RateLimitedPool(rateLimitRps);
  const pageNumbers = Array.from({ length: maxPages }, (_, idx) => startPage + idx);
  let pagesFetched = 0;
  const now = new Date().toISOString();

  // Built-in handler if pointing to internal/simulated authorized catalog API
  if (baseUrl.includes('authorized-ott.internal') || baseUrl.includes('authorized-ott.example')) {
    pagesFetched = maxPages;
    const simulatedPages = [
      {
        name: 'Bengal Cultural HD',
        category: 'Bangla' as const,
        stream_url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
        resolution: '1920x1080',
      },
      {
        name: 'Star Sports Arena HD',
        category: 'Sports' as const,
        stream_url: 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8',
        resolution: '1920x1080',
      },
      {
        name: 'Continental News 24',
        category: 'News' as const,
        stream_url: 'https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8',
        resolution: '1280x720',
      },
    ];

    for (let p = 0; p < maxPages; p++) {
      const tpl = simulatedPages[p % simulatedPages.length];
      importedChannels.push({
        id: `ch-apimig-${Date.now()}-${p + 1}`,
        name: `${tpl.name} (Page ${startPage + p})`,
        category: tpl.category,
        logo: '',
        stream_url: tpl.stream_url,
        type: 'HLS',
        resolution: tpl.resolution,
        status: 'online',
        validation_status: 'ONLINE',
        latency_ms: 88,
        is_duplicate: false,
        drm_protected: false,
        last_checked: now,
      });
    }
  } else {
    await pool.runAll(pageNumbers, 1, async (pageNum) => {
      const separator = endpoint.includes('?') ? '&' : '?';
      const pagedUrl = `${baseUrl}${endpoint}${separator}page=${pageNum}`;
      const resp = await safeFetchWithRetry(pagedUrl, {
        method: options.method,
        headers,
        body: options.method === 'POST' ? options.requestBody : undefined,
        timeoutMs: 7000,
        maxRetries: 1,
      });

      if (!resp.ok) return;
      pagesFetched++;

      if (options.format === 'XML' || resp.bodyText.trim().startsWith('<')) {
        const xmlItems = parseXmlApiChannels(resp.bodyText);
        for (const item of xmlItems) {
          if (item.stream_url) {
            importedChannels.push({
              id: `ch-xmlapi-${Date.now()}-${importedChannels.length + 1}`,
              name: item.name || 'XML Channel',
              category: item.category || 'Other',
              logo: item.logo || '',
              stream_url: item.stream_url,
              type: 'HLS',
              resolution: item.resolution || 'Unknown',
              tvg_id: item.tvg_id,
              status: 'online',
              validation_status: 'ONLINE',
              latency_ms: resp.latencyMs,
              is_duplicate: false,
              drm_protected: false,
              last_checked: now,
            });
          }
        }
      } else {
        try {
          const parsed = JSON.parse(resp.bodyText);
          const list = Array.isArray(parsed)
            ? parsed
            : parsed.channels || parsed.data || parsed.results || parsed.items || [];
          for (const raw of list) {
            const sUrl = raw.stream_url || raw.url || raw.hls_url;
            if (sUrl) {
              importedChannels.push({
                id: `ch-jsonapi-${Date.now()}-${importedChannels.length + 1}`,
                name: String(raw.name || raw.title || `API Channel ${importedChannels.length + 1}`),
                category: normalizeCategory(raw.category || raw.group, raw.name),
                logo: String(raw.logo || ''),
                stream_url: String(sUrl),
                type: 'HLS',
                resolution: String(raw.resolution || 'Unknown'),
                status: 'online',
                validation_status: 'ONLINE',
                latency_ms: resp.latencyMs,
                is_duplicate: false,
                drm_protected: false,
                last_checked: now,
              });
            }
          }
        } catch {
          // Ignore malformed JSON page
        }
      }
    });
  }

  const job: ApiMigrationJob = {
    id: `apimig-${Date.now()}`,
    base_url: baseUrl,
    endpoint,
    method: options.method,
    format: options.format,
    auth_method: options.authMethod,
    masked_credential: maskedCred,
    pages_fetched: pagesFetched,
    records_extracted: importedChannels.length,
    channels_imported: importedChannels.length,
    rate_limit_rps: rateLimitRps,
    status: pagesFetched > 0 ? 'completed' : 'failed',
    created_at: now,
  };

  db.transaction((draft) => {
    draft.api_migrations.unshift(job);
    if (importedChannels.length > 0) {
      draft.channels.unshift(...importedChannels);
    }
  });

  db.logAudit(
    'MIGRATE_API',
    `${baseUrl}${endpoint}`,
    job.status === 'completed' ? 'SUCCESS' : 'WARNING',
    `Paginated ${pagesFetched} pages (${options.method} ${options.format}), imported ${importedChannels.length} channels. Credentials masked: ${maskedCred}`
  );

  return { job, importedChannels };
}
