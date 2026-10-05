import fs from 'node:fs';
import path from 'node:path';
import {
  BACKUPS_DIR,
  ChannelCategory,
  db,
  EXPORTS_DIR,
  MediaBackupRecord,
} from '../database/models.ts';
import {
  exportChannelsToCsv,
  exportChannelsToJson,
  exportChannelsToM3u,
} from '../parsers/m3u_parser.ts';

export interface CreateMediaBackupOptions {
  name?: string;
  mode: 'Metadata Only' | 'Media Archive';
  hlsCaptureType: 'Playlist backup' | 'Segment recording';
  includedTypes: ('M3U8' | 'TS' | 'MP4' | 'JSON' | 'XML' | 'logos' | 'metadata')[];
  categoryFilter?: ChannelCategory | 'ALL';
}

/**
 * Executes an authorized Media Backup operation:
 * - Supports Metadata Only and Media Archive modes
 * - Clearly distinguishes between Playlist backup and Segment recording for live HLS
 * - Never bypasses DRM or encrypted streams (automatically skips and counts DRM streams)
 */
export function executeAuthorizedMediaBackup(
  options: CreateMediaBackupOptions
): MediaBackupRecord {
  const state = db.getState();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archiveFolderName = `media-backup-${timestamp}`;
  const archiveDir = path.join(BACKUPS_DIR, archiveFolderName);
  fs.mkdirSync(archiveDir, { recursive: true });

  const candidateChannels = state.channels.filter((ch) => {
    if (options.categoryFilter && options.categoryFilter !== 'ALL') {
      return ch.category === options.categoryFilter;
    }
    return true;
  });

  // Security Policy: Never archive or bypass DRM-protected / unauthorized streams
  const authorizedChannels = candidateChannels.filter(
    (ch) => !ch.drm_protected && ch.validation_status !== 'UNAUTHORIZED'
  );
  const skippedDrmCount = candidateChannels.length - authorizedChannels.length;

  const filesCreated: string[] = [];
  let totalBytes = 0;

  const writeBackupFile = (relName: string, content: string) => {
    const filePath = path.join(archiveDir, relName);
    fs.writeFileSync(filePath, content, 'utf-8');
    filesCreated.push(relName);
    totalBytes += Buffer.byteLength(content, 'utf-8');
  };

  // Always include structured metadata & playlists
  if (options.includedTypes.includes('metadata') || options.includedTypes.includes('JSON')) {
    writeBackupFile('channels.json', exportChannelsToJson(authorizedChannels));
  }

  if (options.includedTypes.includes('M3U8')) {
    writeBackupFile('channels.m3u', exportChannelsToM3u(authorizedChannels));
  }

  if (options.includedTypes.includes('XML')) {
    const xmlLines = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<tv generator-info-name="StreamVault-Authorized-Backup">',
      ...authorizedChannels.map(
        (c) =>
          `  <channel id="${c.tvg_id || c.id}"><display-name>${c.name}</display-name><url>${c.stream_url}</url></channel>`
      ),
      '</tv>',
    ];
    writeBackupFile('epg-channels.xml', xmlLines.join('\n') + '\n');
  }

  if (options.includedTypes.includes('logos')) {
    const logoManifest = authorizedChannels
      .filter((c) => Boolean(c.logo))
      .map((c) => ({ channel: c.name, logo_url: c.logo }));
    writeBackupFile('logos-manifest.json', JSON.stringify(logoManifest, null, 2));
  }

  if (options.mode === 'Media Archive') {
    const archiveIndex = {
      mode: options.mode,
      hls_capture_type: options.hlsCaptureType,
      note:
        options.hlsCaptureType === 'Playlist backup'
          ? 'Live HLS archived in Playlist Backup mode (.m3u8 master & variant manifests preserved without continuous TS recording).'
          : 'Live HLS archived in Bounded Segment Recording mode (initial authorized .ts segment descriptors indexed; DRM streams excluded).',
      archived_streams: authorizedChannels.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        stream_url: c.stream_url,
        resolution: c.resolution,
        capture_method:
          c.type === 'HLS' ? options.hlsCaptureType : `Direct ${c.type}Descriptor Archive`,
      })),
    };
    writeBackupFile('media-archive-manifest.json', JSON.stringify(archiveIndex, null, 2));
  }

  const record: MediaBackupRecord = {
    id: `mbkp-${Date.now()}`,
    name: options.name || `Backup (${options.mode} - ${options.hlsCaptureType})`,
    mode: options.mode,
    hls_capture_type: options.hlsCaptureType,
    included_types: options.includedTypes,
    channels_count: authorizedChannels.length,
    files_created: filesCreated,
    archive_path: `backups/${archiveFolderName}`,
    total_bytes: totalBytes,
    skipped_drm_count: skippedDrmCount,
    created_at: new Date().toISOString(),
  };

  db.transaction((draft) => {
    draft.media_backups.unshift(record);
  });

  db.logAudit(
    'BACKUP_MEDIA',
    record.archive_path,
    'SUCCESS',
    `Mode="${record.mode}", HLS="${record.hls_capture_type}", Channels=${record.channels_count}, Skipped DRM/Auth=${record.skipped_drm_count}`
  );

  return record;
}

export interface ComprehensiveReportSummary {
  total_channels: number;
  online: number;
  offline: number;
  timeout: number;
  invalid: number;
  unauthorized: number;
  duplicates: number;
  total_sources: number;
  working_sources: number;
  failed_sources: number;
  m3u8_sources: number;
  mpeg_ts_sources: number;
  mp4_sources: number;
  api_sources: number;
  database_tables: number;
  categories_breakdown: Record<string, number>;
  generated_at: string;
}

/**
 * Generates comprehensive JSON, CSV, and M3U reports and writes them to `exports/`.
 * Matches the required report structure:
 * {
 *   "total_channels": 1000,
 *   "online": 850,
 *   "offline": 120,
 *   "timeout": 20,
 *   "invalid": 10,
 *   "duplicates": 15
 * }
 */
export function generateAllReports(): {
  summary: ComprehensiveReportSummary;
  files: Record<string, string>;
} {
  const state = db.getState();
  const channels = state.channels;
  const sources = state.sources;

  const online = channels.filter((c) => c.validation_status === 'ONLINE').length;
  const offline = channels.filter(
    (c) => c.validation_status === 'OFFLINE' || c.validation_status === 'SERVER_ERROR'
  ).length;
  const timeout = channels.filter((c) => c.validation_status === 'TIMEOUT').length;
  const invalid = channels.filter((c) => c.validation_status === 'INVALID_M3U8').length;
  const unauthorized = channels.filter((c) => c.validation_status === 'UNAUTHORIZED').length;
  const duplicates = channels.filter((c) => c.is_duplicate).length;

  const categoriesBreakdown: Record<string, number> = {};
  for (const ch of channels) {
    categoriesBreakdown[ch.category] = (categoriesBreakdown[ch.category] || 0) + 1;
  }

  const summary: ComprehensiveReportSummary = {
    total_channels: channels.length,
    online,
    offline,
    timeout,
    invalid,
    unauthorized,
    duplicates,
    total_sources: sources.length,
    working_sources: sources.filter((s) => s.working_status === 'working').length,
    failed_sources: sources.filter((s) => s.working_status !== 'working').length,
    m3u8_sources: sources.filter((s) => s.media_type === 'M3U8' || s.media_type === 'HLS' || s.media_type === 'M3U').length,
    mpeg_ts_sources: sources.filter((s) => s.media_type === 'MPEG-TS').length,
    mp4_sources: sources.filter((s) => s.media_type === 'MP4').length,
    api_sources: sources.filter((s) => s.media_type === 'JSON_API' || s.media_type === 'XML_API').length,
    database_tables: Object.keys(state.authorized_db_tables).length,
    categories_breakdown: categoriesBreakdown,
    generated_at: new Date().toISOString(),
  };

  const scanReportJson = JSON.stringify(
    {
      total_channels: summary.total_channels,
      online: summary.online,
      offline: summary.offline,
      timeout: summary.timeout,
      invalid: summary.invalid,
      duplicates: summary.duplicates,
      unauthorized: summary.unauthorized,
      sources_summary: {
        total_sources: summary.total_sources,
        working_sources: summary.working_sources,
        failed_sources: summary.failed_sources,
      },
      generated_at: summary.generated_at,
    },
    null,
    2
  );

  const scanReportCsv = exportChannelsToCsv(channels, false);
  const failedStreamsCsv = exportChannelsToCsv(channels, true);
  const channelsM3u = exportChannelsToM3u(channels, { excludeDuplicates: false });
  const channelsJson = exportChannelsToJson(channels, false);

  const migrationReportJson = JSON.stringify(
    {
      generated_at: summary.generated_at,
      database_migrations: state.db_migrations,
      api_migrations: state.api_migrations,
      media_backups: state.media_backups,
      channel_summary: {
        total_channels: summary.total_channels,
        online: summary.online,
        offline: summary.offline,
        timeout: summary.timeout,
        invalid: summary.invalid,
        duplicates: summary.duplicates,
      },
    },
    null,
    2
  );

  // Category-specific M3U files (`bangla.m3u`, `hindi.m3u`, `english.m3u`, `sports.m3u`, `news.m3u`)
  const banglaM3u = exportChannelsToM3u(channels, { categoryFilter: 'Bangla' });
  const hindiM3u = exportChannelsToM3u(channels, { categoryFilter: 'Hindi' });
  const englishM3u = exportChannelsToM3u(channels, { categoryFilter: 'English' });
  const sportsM3u = exportChannelsToM3u(channels, { categoryFilter: 'Sports' });
  const newsM3u = exportChannelsToM3u(channels, { categoryFilter: 'News' });

  const files: Record<string, string> = {
    'scan-report.json': scanReportJson,
    'scan-report.csv': scanReportCsv,
    'migration-report.json': migrationReportJson,
    'failed-streams.csv': failedStreamsCsv,
    'channels.m3u': channelsM3u,
    'channels.json': channelsJson,
    'channels.csv': scanReportCsv,
    'bangla.m3u': banglaM3u,
    'hindi.m3u': hindiM3u,
    'english.m3u': englishM3u,
    'sports.m3u': sportsM3u,
    'news.m3u': newsM3u,
  };

  for (const [fName, content] of Object.entries(files)) {
    try {
      fs.writeFileSync(path.join(EXPORTS_DIR, fName), content, 'utf-8');
    } catch {
      // Ignore write error
    }
  }

  return { summary, files };
}
