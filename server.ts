import express from 'express';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { executeCliCommandString } from './cli.ts';
import { ChannelCategory, db } from './database/models.ts';
import { executeAuthorizedMediaBackup, generateAllReports } from './exports/backup_manager.ts';
import {
  createDatabaseBackup,
  executeAuthorizedApiMigration,
  executeAuthorizedDatabaseMigration,
  generateSqlMigrationScript,
  inspectAuthorizedDatabaseSchema,
  restoreDatabaseFromBackup,
  SupportedDbDialect,
} from './migrations/db_migrator.ts';
import { analyzeHlsManifest } from './parsers/hls_analyzer.ts';
import {
  detectDuplicates,
  DuplicateDetectionRule,
  exportChannelsToCsv,
  exportChannelsToJson,
  exportChannelsToM3u,
  parseM3uPlaylist,
} from './parsers/m3u_parser.ts';
import { runAuthorizedSourceScan } from './scanner/source_scanner.ts';
import { getSecurityConfig, updateSecurityConfig } from './scanner/ssrf_guard.ts';
import { runAutomatedTestSuite } from './tests/suite.ts';
import { validateStreamsBatch } from './validators/stream_validator.ts';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  // Dynamic SVG logo endpoint so channel logos are always crisp and never broken
  app.get('/api/assets/logo/:name', (req, res) => {
    const rawName = (req.params.name || 'CH').replace(/\.svg$/i, '').toUpperCase();
    const initials = rawName
      .split(/[-_]/)
      .map((p) => p[0] || '')
      .join('')
      .slice(0, 3) || 'TV';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" width="80" height="80">
      <rect width="80" height="80" rx="12" fill="#0F172A" stroke="#334155" stroke-width="2"/>
      <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="#10B981" font-family="monospace" font-weight="700" font-size="22">${initials}</text>
    </svg>`;
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(svg);
  });

  // 1. Get complete application state, dashboard metrics, and security configuration
  app.get('/api/state', (_req, res) => {
    const state = db.getState();
    const { summary } = generateAllReports();
    res.json({
      summary,
      securityConfig: getSecurityConfig(),
      sources: state.sources,
      channels: state.channels,
      hls_analyses: state.hls_analyses,
      db_migrations: state.db_migrations,
      api_migrations: state.api_migrations,
      media_backups: state.media_backups,
      checkpoints: state.checkpoints,
      audit_logs: state.audit_logs,
      authorized_db_tables: db.getSanitizedAuthorizedTables(),
      target_db_tables: state.target_db_tables,
    });
  });

  // 2. Source Scanner endpoint
  app.post('/api/scan', async (req, res) => {
    try {
      const {
        targetUrl,
        localContent,
        localFileName,
        sourceType,
        timeoutMs,
        maxRetries,
        concurrency,
        rateLimitRps,
      } = req.body;
      const result = await runAuthorizedSourceScan({
        targetUrl,
        localContent,
        localFileName,
        sourceType,
        timeoutMs: timeoutMs ? Number(timeoutMs) : undefined,
        maxRetries: maxRetries !== undefined ? Number(maxRetries) : undefined,
        concurrency: concurrency ? Number(concurrency) : undefined,
        rateLimitRps: rateLimitRps ? Number(rateLimitRps) : undefined,
      });
      res.json(result);
    } catch (err: unknown) {
      res.status(400).json({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // 3. HLS Analyzer endpoint
  app.post('/api/hls/analyze', async (req, res) => {
    try {
      const { masterUrl, rawManifestContent, fetchVariants = true } = req.body;
      const urlToUse = masterUrl || 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
      const report = await analyzeHlsManifest(urlToUse, rawManifestContent, Boolean(fetchVariants));
      db.transaction((draft) => {
        draft.hls_analyses.unshift(report);
      });
      db.logAudit(
        'ANALYZE_HLS',
        urlToUse,
        report.valid_syntax ? 'SUCCESS' : 'WARNING',
        `Analyzed HLS playlist: ${report.variants.length} variants, ${report.total_segments} segments, DRM=${report.drm_or_encrypted}`
      );
      res.json(report);
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // 4. M3U/M3U8 Parser & Importer endpoint
  app.post('/api/m3u/parse', (req, res) => {
    try {
      const {
        content,
        baseUrl = '',
        duplicateRule = 'stream_url',
        importToCatalog = true,
      } = req.body;
      if (!content || typeof content !== 'string') {
        res.status(400).json({ error: 'M3U/M3U8 playlist content is required.' });
        return;
      }

      const parsed = parseM3uPlaylist(content, baseUrl, duplicateRule as DuplicateDetectionRule);
      if (importToCatalog && parsed.channels.length > 0) {
        db.transaction((draft) => {
          draft.channels.unshift(...parsed.channels);
          draft.channels = detectDuplicates(draft.channels, duplicateRule as DuplicateDetectionRule);
        });
        db.logAudit(
          'PARSE_M3U',
          baseUrl || 'Direct M3U Payload',
          'SUCCESS',
          `Parsed and imported ${parsed.channels.length} channels (${parsed.duplicatesCount} duplicates flagged by ${duplicateRule}).`
        );
      }

      res.json(parsed);
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // 5. Re-run duplicate detection rule on channel inventory
  app.post('/api/channels/duplicates', (req, res) => {
    const { rule = 'stream_url', removeDuplicates = false } = req.body;
    let duplicatesCount = 0;
    db.transaction((draft) => {
      const evaluated = detectDuplicates(draft.channels, rule as DuplicateDetectionRule);
      duplicatesCount = evaluated.filter((c) => c.is_duplicate).length;
      draft.channels = removeDuplicates ? evaluated.filter((c) => !c.is_duplicate) : evaluated;
    });
    res.json({
      rule,
      duplicatesCount,
      channels: db.getState().channels,
    });
  });

  // 6. Export playlist in M3U, JSON, CSV, or Category-specific M3U
  app.get('/api/export/:filename', (req, res) => {
    const filename = req.params.filename.toLowerCase();
    const excludeDuplicates = req.query.excludeDuplicates === 'true';
    const channels = db.getState().channels;

    const categoryMap: Record<string, ChannelCategory> = {
      'bangla.m3u': 'Bangla',
      'hindi.m3u': 'Hindi',
      'english.m3u': 'English',
      'sports.m3u': 'Sports',
      'news.m3u': 'News',
      'movies.m3u': 'Movies',
      'kids.m3u': 'Kids',
      'music.m3u': 'Music',
      'international.m3u': 'International',
    };

    if (categoryMap[filename]) {
      const m3u = exportChannelsToM3u(channels, {
        excludeDuplicates,
        categoryFilter: categoryMap[filename],
      });
      db.logAudit('EXPORT_PLAYLIST', filename, 'SUCCESS', `Exported category playlist ${filename}`);
      res.setHeader('Content-Type', 'audio/x-mpegurl');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(m3u);
      return;
    }

    if (filename === 'channels.json') {
      const json = exportChannelsToJson(channels, excludeDuplicates);
      db.logAudit('EXPORT_PLAYLIST', 'channels.json', 'SUCCESS', `Exported ${channels.length} channels to JSON`);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename="channels.json"');
      res.send(json);
      return;
    }

    if (filename === 'channels.csv' || filename === 'failed-streams.csv' || filename === 'scan-report.csv') {
      const onlyFailed = filename === 'failed-streams.csv';
      const csv = exportChannelsToCsv(channels, onlyFailed);
      db.logAudit('EXPORT_PLAYLIST', filename, 'SUCCESS', `Exported CSV (${filename})`);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csv);
      return;
    }

    if (filename === 'scan-report.json' || filename === 'migration-report.json') {
      const { files } = generateAllReports();
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(files[filename] || '{}');
      return;
    }

    // Default M3U export
    const m3u = exportChannelsToM3u(channels, { excludeDuplicates });
    db.logAudit('EXPORT_PLAYLIST', 'channels.m3u', 'SUCCESS', `Exported ${channels.length} channels to M3U`);
    res.setHeader('Content-Type', 'audio/x-mpegurl');
    res.setHeader('Content-Disposition', 'attachment; filename="channels.m3u"');
    res.send(m3u);
  });

  // 7. Stream Validator endpoint
  app.post('/api/validate', async (req, res) => {
    try {
      const { channelIds, timeoutMs, maxRetries, concurrency, rateLimitRps } = req.body;
      const results = await validateStreamsBatch(channelIds, {
        timeoutMs: timeoutMs ? Number(timeoutMs) : undefined,
        maxRetries: maxRetries !== undefined ? Number(maxRetries) : undefined,
        concurrency: concurrency ? Number(concurrency) : undefined,
        rateLimitRps: rateLimitRps ? Number(rateLimitRps) : undefined,
      });
      res.json({
        results,
        channels: db.getState().channels,
      });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // 8. Authorized Database Schema Inspection & Migration endpoints
  app.post('/api/db/inspect', (req, res) => {
    try {
      const { connectionUrl } = req.body;
      const result = inspectAuthorizedDatabaseSchema(connectionUrl || '');
      res.json(result);
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/db/backup', (req, res) => {
    try {
      const { connectionUrl, selectedTables } = req.body;
      const result = createDatabaseBackup(
        connectionUrl || 'sqlite:///./data/authorized_source_ott.db',
        selectedTables
      );
      res.json(result);
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/db/restore', (req, res) => {
    try {
      const { backupFileName } = req.body;
      const result = restoreDatabaseFromBackup(backupFileName);
      res.json(result);
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/db/generate-sql', (req, res) => {
    try {
      const { targetDialect = 'postgresql', selectedTables } = req.body;
      const result = generateSqlMigrationScript(
        targetDialect as SupportedDbDialect,
        selectedTables
      );
      res.json(result);
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/db/migrate', (req, res) => {
    try {
      const { sourceConnectionUrl, targetConnectionUrl, selectedTables, confirmed } = req.body;
      if (!confirmed) {
        res.status(400).json({
          error: 'Explicit operator confirmation is required before executing database migration.',
        });
        return;
      }
      const job = executeAuthorizedDatabaseMigration({
        sourceConnectionUrl: sourceConnectionUrl || 'sqlite:///./data/authorized_source_ott.db',
        targetConnectionUrl: targetConnectionUrl || 'sqlite:///./data/authorized_target_ott.db',
        selectedTables: selectedTables || [],
      });
      res.json(job);
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // 9. Authorized API Migration endpoint
  app.post('/api/api-migration/run', async (req, res) => {
    try {
      const result = await executeAuthorizedApiMigration(req.body);
      res.json(result);
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // 10. Media Backup endpoint
  app.post('/api/media-backup/run', (req, res) => {
    try {
      const record = executeAuthorizedMediaBackup(req.body);
      res.json(record);
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // 11. Reports generator endpoint
  app.get('/api/reports/all', (_req, res) => {
    const result = generateAllReports();
    res.json(result);
  });

  // 12. Security configuration endpoint
  app.post('/api/security/config', (req, res) => {
    const updated = updateSecurityConfig(req.body);
    db.logAudit(
      'SCAN_SOURCE',
      'Security Policy Update',
      'SUCCESS',
      `Updated security config: allowPrivateNetworks=${updated.allowPrivateNetworks}, rateLimitRps=${updated.rateLimitRps}, concurrency=${updated.concurrency}`
    );
    res.json(updated);
  });

  // 13. Interactive CLI execution endpoint
  app.post('/api/cli/execute', async (req, res) => {
    const { commandLine } = req.body;
    const result = await executeCliCommandString(String(commandLine || 'help'));
    res.json(result);
  });

  // 14. Automated Test Suite endpoint
  app.post('/api/tests/run', async (_req, res) => {
    const testReport = await runAutomatedTestSuite();
    res.json(testReport);
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`StreamVault OTT Migration & Backup Suite running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
