#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { db, EXPORTS_DIR } from './database/models.ts';
import { executeAuthorizedMediaBackup, generateAllReports } from './exports/backup_manager.ts';
import {
  createDatabaseBackup,
  executeAuthorizedDatabaseMigration,
} from './migrations/db_migrator.ts';
import { analyzeHlsManifest } from './parsers/hls_analyzer.ts';
import {
  exportChannelsToCsv,
  exportChannelsToJson,
  exportChannelsToM3u,
  parseM3uPlaylist,
} from './parsers/m3u_parser.ts';
import { runAuthorizedSourceScan } from './scanner/source_scanner.ts';
import { validateStreamsBatch } from './validators/stream_validator.ts';

export interface CliFlags {
  timeout: number;
  retries: number;
  concurrency: number;
  rateLimit: number;
  output?: string;
  format: 'json' | 'm3u' | 'csv' | 'text';
}

export function parseCliArgs(argv: string[]): {
  command: string;
  target: string;
  flags: CliFlags;
} {
  const cleaned = argv.filter((a) => a !== 'ott-tool');
  const positional: string[] = [];
  const flags: CliFlags = {
    timeout: 8000,
    retries: 3,
    concurrency: 5,
    rateLimit: 10,
    format: 'text',
  };

  for (let i = 0; i < cleaned.length; i++) {
    const token = cleaned[i];
    if (token === '--timeout' && cleaned[i + 1]) {
      flags.timeout = Number(cleaned[++i]) || 8000;
    } else if (token === '--retries' && cleaned[i + 1]) {
      flags.retries = Number(cleaned[++i]) || 3;
    } else if (token === '--concurrency' && cleaned[i + 1]) {
      flags.concurrency = Number(cleaned[++i]) || 5;
    } else if (token === '--rate-limit' && cleaned[i + 1]) {
      flags.rateLimit = Number(cleaned[++i]) || 10;
    } else if (token === '--output' && cleaned[i + 1]) {
      flags.output = cleaned[++i];
    } else if (token === '--format' && cleaned[i + 1]) {
      const f = cleaned[++i].toLowerCase();
      if (f === 'json' || f === 'm3u' || f === 'csv' || f === 'text') {
        flags.format = f;
      }
    } else if (!token.startsWith('--')) {
      positional.push(token);
    }
  }

  return {
    command: (positional[0] || 'help').toLowerCase(),
    target: positional[1] || '',
    flags,
  };
}

export async function executeCliCommandString(rawCommandLine: string): Promise<{
  exitCode: number;
  output: string;
}> {
  const tokens =
    rawCommandLine
      .trim()
      .match(/(?:[^\s"]+|"[^"]*")+/g)
      ?.map((t) => t.replace(/^"|"$/g, '')) || [];

  const { command, target, flags } = parseCliArgs(tokens);

  try {
    if (command === 'help' || command === '--help' || command === '-h') {
      return {
        exitCode: 0,
        output: [
          'StreamVault OTT / HLS Migration & Backup CLI (ott-tool v1.0.0)',
          'Authorized Systems Only — SSRF Protection, Secret Masking & Rate Limiting Active',
          '',
          'Usage:',
          '  ott-tool scan <URL>                  Scan authorized website, API, M3U, or HLS endpoint',
          '  ott-tool analyze <M3U8_URL>          Parse Master/Variant M3U8 & build dependency tree',
          '  ott-tool validate [playlist.m3u]     Validate streams (HTTP, M3U8 syntax, latency, codecs)',
          '  ott-tool export <channels.m3u>       Export channels to .m3u, .json, or .csv',
          '  ott-tool backup database             Create timestamped snapshot of authorized database',
          '  ott-tool migrate database            Run 9-step transactional database migration',
          '  ott-tool report                      Generate scan-report.json, failed-streams.csv & summaries',
          '',
          'Flags:',
          '  --timeout <ms>         Connection timeout in milliseconds (default: 8000)',
          '  --retries <count>      Retry attempts with exponential backoff (default: 3)',
          '  --concurrency <num>    Worker pool concurrency limit (default: 5)',
          '  --rate-limit <rps>     Max requests per second (default: 10)',
          '  --output <filepath>    Output file name in exports/',
          '  --format <fmt>         Output format: json | m3u | csv | text',
        ].join('\n'),
      };
    }

    if (command === 'scan') {
      const scanUrl = target || 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
      const res = await runAuthorizedSourceScan({
        targetUrl: scanUrl,
        timeoutMs: flags.timeout,
        maxRetries: flags.retries,
        concurrency: flags.concurrency,
        rateLimitRps: flags.rateLimit,
      });

      const payload = {
        command: 'scan',
        target: scanUrl,
        flags,
        checkpoint_id: res.checkpoint.id,
        sources_found: res.scannedSources.length,
        channels_discovered: res.discoveredChannels.length,
        sources: res.scannedSources,
      };

      return {
        exitCode: 0,
        output:
          flags.format === 'json'
            ? JSON.stringify(payload, null, 2)
            : [
                `[SCAN COMPLETED] Target: ${scanUrl}`,
                `  Timeout: ${flags.timeout}ms | Retries: ${flags.retries} | Concurrency: ${flags.concurrency} | Rate Limit: ${flags.rateLimit} RPS`,
                `  Sources Detected: ${res.scannedSources.length}`,
                `  Channels Discovered: ${res.discoveredChannels.length}`,
                ...res.scannedSources.map(
                  (s) =>
                    `  - [${s.working_status.toUpperCase()}] HTTP ${s.http_status} | ${s.media_type} | ${s.response_time_ms}ms | ${s.url}`
                ),
              ].join('\n'),
      };
    }

    if (command === 'analyze') {
      const m3u8Url = target || 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
      const report = await analyzeHlsManifest(m3u8Url, undefined, true);
      db.transaction((draft) => {
        draft.hls_analyses.unshift(report);
      });
      db.logAudit('ANALYZE_HLS', m3u8Url, 'SUCCESS', `CLI analyzed HLS manifest (${report.variants.length} variants).`);

      if (flags.format === 'json') {
        return { exitCode: 0, output: JSON.stringify(report, null, 2) };
      }

      const treeLines: string[] = [
        `[HLS DEPENDENCY TREE] ${report.master_url}`,
        `  Syntax Valid: ${report.valid_syntax ? 'YES' : 'NO'} | Master Playlist: ${report.is_master_playlist ? 'YES' : 'NO'} | DRM/Encrypted: ${report.drm_or_encrypted ? 'YES (Bypass Disabled)' : 'NO'}`,
        `  Recognized Tags: ${report.recognized_tags.join(', ')}`,
        '',
        'Master M3U8',
      ];

      report.variants.forEach((v, idx) => {
        const isLastVar = idx === report.variants.length - 1;
        const branch = isLastVar ? ' └── ' : ' ├── ';
        const childPrefix = isLastVar ? '      ' : ' │    ';
        treeLines.push(
          `${branch}${v.resolution} playlist (${Math.round(v.bandwidth / 1000)} kbps, codecs: ${v.codecs})`
        );
        v.segments.slice(0, 4).forEach((seg, sIdx) => {
          const segLast = sIdx === Math.min(3, v.segments.length - 1);
          const segBranch = segLast ? '└── ' : '├── ';
          const segName = seg.url.split('/').pop() || `segment_${seg.index}.ts`;
          treeLines.push(`${childPrefix}${segBranch}${segName} (${seg.duration}s)`);
        });
      });

      return { exitCode: 0, output: treeLines.join('\n') };
    }

    if (command === 'validate') {
      if (target && target.endsWith('.m3u') && fs.existsSync(target)) {
        const raw = fs.readFileSync(target, 'utf-8');
        const parsed = parseM3uPlaylist(raw);
        db.transaction((s) => {
          s.channels.unshift(...parsed.channels);
        });
      }
      const results = await validateStreamsBatch(undefined, {
        timeoutMs: flags.timeout,
        maxRetries: flags.retries,
        concurrency: flags.concurrency,
        rateLimitRps: flags.rateLimit,
      });

      const online = results.filter((r) => r.validation_status === 'ONLINE').length;
      return {
        exitCode: 0,
        output:
          flags.format === 'json'
            ? JSON.stringify(results, null, 2)
            : [
                `[STREAM VALIDATION COMPLETED] Total: ${results.length} | ONLINE: ${online} | OTHER: ${results.length - online}`,
                ...results.map(
                  (r) =>
                    `  - [${r.validation_status.padEnd(12)}] ${r.name.padEnd(32)} | HTTP ${r.http_status} | ${r.latency_ms}ms | ${r.detected_resolution}`
                ),
              ].join('\n'),
      };
    }

    if (command === 'export') {
      const outName = flags.output || target || 'channels.m3u';
      const channels = db.getState().channels;
      let content = '';
      if (outName.endsWith('.json') || flags.format === 'json') {
        content = exportChannelsToJson(channels);
      } else if (outName.endsWith('.csv') || flags.format === 'csv') {
        content = exportChannelsToCsv(channels);
      } else {
        content = exportChannelsToM3u(channels);
      }
      const outPath = path.join(EXPORTS_DIR, path.basename(outName));
      fs.writeFileSync(outPath, content, 'utf-8');
      db.logAudit('EXPORT_PLAYLIST', outName, 'SUCCESS', `CLI exported ${channels.length} channels to exports/${path.basename(outName)}`);
      return {
        exitCode: 0,
        output: `[EXPORT SUCCESS] Wrote ${channels.length} channels to exports/${path.basename(outName)} (${Buffer.byteLength(content, 'utf-8')} bytes).\n\nPreview:\n${content.slice(0, 600)}`,
      };
    }

    if (command === 'backup') {
      if (target === 'database' || !target) {
        const bkp = createDatabaseBackup('sqlite:///./data/authorized_source_ott.db');
        return {
          exitCode: 0,
          output: `[DATABASE BACKUP CREATED]\n  Backup ID: ${bkp.backup_id}\n  File: backups/${bkp.backup_file}\n  Tables: ${bkp.tables_backed_up.join(', ')}\n  Total Rows: ${bkp.total_rows}`,
        };
      }
      const mediaBkp = executeAuthorizedMediaBackup({
        mode: 'Metadata Only',
        hlsCaptureType: 'Playlist backup',
        includedTypes: ['M3U8', 'JSON', 'XML', 'metadata'],
      });
      return {
        exitCode: 0,
        output: `[MEDIA BACKUP CREATED]\n  Archive: ${mediaBkp.archive_path}\n  Channels Archived: ${mediaBkp.channels_count}\n  DRM Streams Skipped: ${mediaBkp.skipped_drm_count}`,
      };
    }

    if (command === 'migrate') {
      const job = executeAuthorizedDatabaseMigration({
        sourceConnectionUrl: 'sqlite:///./data/authorized_source_ott.db',
        targetConnectionUrl: 'postgresql://ott_admin:secretpass@db-target.internal:5432/ott_prod',
        selectedTables: [
          'ott_categories',
          'ott_channels',
          'ott_epg_sources',
          'ott_transcode_profiles',
          'ott_cdn_origins',
        ],
      });
      return {
        exitCode: 0,
        output: [
          `[DATABASE MIGRATION COMPLETED] Job ID: ${job.id}`,
          `  Source: ${job.source_connection_masked} (${job.source_dialect})`,
          `  Target: ${job.target_connection_masked} (${job.target_dialect})`,
          `  Pre-Migration Backup: ${job.backup_file_path}`,
          `  Sensitive Columns Masked: ${job.sensitive_fields_masked.join(', ')}`,
          `  Row Count Verification:`,
          ...Object.entries(job.rows_migrated).map(
            ([tbl, stats]) =>
              `    - ${tbl}: source=${stats.source_count}, target=${stats.target_count}, verified=${stats.verified ? 'OK' : 'MISMATCH'}`
          ),
        ].join('\n'),
      };
    }

    if (command === 'report') {
      const { summary } = generateAllReports();
      const reportObj = {
        total_channels: summary.total_channels,
        online: summary.online,
        offline: summary.offline,
        timeout: summary.timeout,
        invalid: summary.invalid,
        duplicates: summary.duplicates,
      };
      return {
        exitCode: 0,
        output: JSON.stringify(reportObj, null, 2),
      };
    }

    return {
      exitCode: 1,
      output: `Unknown command "${command}". Run "ott-tool help" for available commands.`,
    };
  } catch (err: unknown) {
    return {
      exitCode: 1,
      output: `[ERROR] ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// Run directly if invoked from CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  executeCliCommandString(process.argv.slice(2).join(' ')).then((res) => {
    console.log(res.output);
    process.exit(res.exitCode);
  });
}
