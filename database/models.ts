import fs from 'node:fs';
import path from 'node:path';
import { maskSecret, sanitizeRecord } from '../scanner/ssrf_guard.ts';

export type MediaType =
  | 'M3U'
  | 'M3U8'
  | 'HLS'
  | 'MPEG-TS'
  | 'MP4'
  | 'JSON_API'
  | 'XML_API'
  | 'LOGO'
  | 'EPG'
  | 'PLAYLIST'
  | 'UNKNOWN';

export type StreamValidationStatus =
  | 'ONLINE'
  | 'OFFLINE'
  | 'TIMEOUT'
  | 'INVALID_M3U8'
  | 'UNAUTHORIZED'
  | 'SERVER_ERROR';

export type ChannelCategory =
  | 'Bangla'
  | 'Hindi'
  | 'English'
  | 'Sports'
  | 'News'
  | 'Movies'
  | 'Kids'
  | 'Music'
  | 'International'
  | 'Other';

export interface ScannedSourceRecord {
  id: string;
  url: string;
  source_origin: string;
  http_status: number;
  content_type: string;
  response_size: number;
  response_time_ms: number;
  media_type: MediaType;
  working_status: 'working' | 'failed' | 'unauthorized';
  error_message?: string;
  discovered_at: string;
}

export interface NormalizedChannelRecord {
  id: string;
  name: string;
  category: ChannelCategory;
  logo: string;
  stream_url: string;
  type: 'HLS' | 'MPEG-TS' | 'MP4' | 'M3U8' | 'UNKNOWN';
  resolution: string;
  codec?: string;
  bandwidth?: number;
  tvg_id?: string;
  tvg_name?: string;
  group_title?: string;
  epg_url?: string;
  status: 'online' | 'offline' | 'timeout' | 'invalid_m3u8' | 'unauthorized' | 'server_error';
  validation_status: StreamValidationStatus;
  latency_ms: number;
  is_duplicate: boolean;
  duplicate_of?: string;
  drm_protected: boolean;
  last_checked: string;
}

export interface HlsVariantNode {
  id: string;
  url: string;
  resolution: string;
  bandwidth: number;
  codecs: string;
  frame_rate?: number;
  audio_group?: string;
  subtitle_group?: string;
  target_duration?: number;
  is_endlist?: boolean;
  encryption_method?: string;
  encryption_key_uri?: string;
  drm_detected: boolean;
  segments: {
    index: number;
    duration: number;
    title?: string;
    url: string;
    status?: 'available' | 'missing' | 'unverified';
  }[];
}

export interface HlsMediaTrack {
  type: 'AUDIO' | 'SUBTITLES' | 'CLOSED-CAPTIONS';
  group_id: string;
  name: string;
  language?: string;
  default: boolean;
  autoselect: boolean;
  uri?: string;
}

export interface HlsAnalysisReport {
  id: string;
  master_url: string;
  is_master_playlist: boolean;
  valid_syntax: boolean;
  recognized_tags: string[];
  target_duration?: number;
  is_vod_endlist: boolean;
  drm_or_encrypted: boolean;
  encryption_details?: string;
  variants: HlsVariantNode[];
  audio_tracks: HlsMediaTrack[];
  subtitle_tracks: HlsMediaTrack[];
  total_segments: number;
  analyzed_at: string;
  warning?: string;
}

export interface DatabaseTableSchema {
  table_name: string;
  row_count: number;
  columns: {
    name: string;
    type: string;
    nullable: boolean;
    is_primary_key: boolean;
    is_sensitive: boolean;
  }[];
  relationships: {
    column: string;
    references_table: string;
    references_column: string;
  }[];
  sample_rows: Record<string, unknown>[];
}

export interface DatabaseMigrationJob {
  id: string;
  source_dialect: 'postgresql' | 'mysql' | 'sqlite';
  target_dialect: 'postgresql' | 'mysql' | 'sqlite';
  source_connection_masked: string;
  target_connection_masked: string;
  selected_tables: string[];
  backup_file_path: string;
  schema_compatible: boolean;
  status: 'completed' | 'failed' | 'in_progress';
  rows_migrated: Record<string, { source_count: number; target_count: number; verified: boolean }>;
  sensitive_fields_masked: string[];
  started_at: string;
  completed_at: string;
}

export interface ApiMigrationJob {
  id: string;
  base_url: string;
  endpoint: string;
  method: 'GET' | 'POST';
  format: 'JSON' | 'XML';
  auth_method: 'none' | 'api_key' | 'bearer';
  masked_credential: string;
  pages_fetched: number;
  records_extracted: number;
  channels_imported: number;
  rate_limit_rps: number;
  status: 'completed' | 'failed';
  created_at: string;
}

export interface MediaBackupRecord {
  id: string;
  name: string;
  mode: 'Metadata Only' | 'Media Archive';
  hls_capture_type: 'Playlist backup' | 'Segment recording';
  included_types: string[];
  channels_count: number;
  files_created: string[];
  archive_path: string;
  total_bytes: number;
  skipped_drm_count: number;
  created_at: string;
}

export interface ScanCheckpoint {
  id: string;
  target_url: string;
  total_items: number;
  processed_items: number;
  status: 'running' | 'paused' | 'completed' | 'failed';
  pending_urls: string[];
  started_at: string;
  updated_at: string;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  operation:
    | 'SCAN_SOURCE'
    | 'ANALYZE_HLS'
    | 'PARSE_M3U'
    | 'VALIDATE_STREAMS'
    | 'INSPECT_DB'
    | 'BACKUP_DB'
    | 'MIGRATE_DB'
    | 'RESTORE_DB'
    | 'MIGRATE_API'
    | 'BACKUP_MEDIA'
    | 'EXPORT_PLAYLIST'
    | 'SECURITY_BLOCK'
    | 'WIZARD_EXECUTION';
  actor: string;
  target: string;
  status: 'SUCCESS' | 'WARNING' | 'BLOCKED' | 'ERROR';
  details: string;
}

export interface AppDatabaseState {
  sources: ScannedSourceRecord[];
  channels: NormalizedChannelRecord[];
  hls_analyses: HlsAnalysisReport[];
  db_migrations: DatabaseMigrationJob[];
  api_migrations: ApiMigrationJob[];
  media_backups: MediaBackupRecord[];
  checkpoints: ScanCheckpoint[];
  audit_logs: AuditLogEntry[];
  authorized_db_tables: Record<string, Record<string, unknown>[]>;
  target_db_tables: Record<string, Record<string, unknown>[]>;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const BACKUPS_DIR = path.resolve(process.cwd(), 'backups');
const EXPORTS_DIR = path.resolve(process.cwd(), 'exports');
const LOGS_DIR = path.resolve(process.cwd(), 'logs');

for (const dir of [DATA_DIR, BACKUPS_DIR, EXPORTS_DIR, LOGS_DIR]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

const DB_FILE_PATH = path.join(DATA_DIR, 'ott_migration_store.json');
const AUDIT_LOG_FILE_PATH = path.join(LOGS_DIR, 'audit.log');

function createInitialSeedState(): AppDatabaseState {
  const now = new Date().toISOString();

  const initialChannels: NormalizedChannelRecord[] = [
    {
      id: 'ch-001',
      name: 'Dhaka Broadcast HD',
      category: 'Bangla',
      logo: '/api/assets/logo/dhaka-hd.svg',
      stream_url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
      type: 'HLS',
      resolution: '1920x1080',
      codec: 'avc1.640028,mp4a.40.2',
      bandwidth: 4605600,
      tvg_id: 'dhaka.hd.bd',
      tvg_name: 'Dhaka Broadcast HD',
      group_title: 'Bangla',
      epg_url: 'https://epg.authorized-ott.example/bangla.xml',
      status: 'online',
      validation_status: 'ONLINE',
      latency_ms: 118,
      is_duplicate: false,
      drm_protected: false,
      last_checked: now,
    },
    {
      id: 'ch-002',
      name: 'Bangla Vision News 24',
      category: 'Bangla',
      logo: '/api/assets/logo/bv-news.svg',
      stream_url: 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8',
      type: 'HLS',
      resolution: '1920x1080',
      codec: 'avc1.64002a,mp4a.40.2',
      bandwidth: 5120000,
      tvg_id: 'bvnews24.bd',
      tvg_name: 'Bangla Vision News 24',
      group_title: 'Bangla',
      status: 'online',
      validation_status: 'ONLINE',
      latency_ms: 94,
      is_duplicate: false,
      drm_protected: false,
      last_checked: now,
    },
    {
      id: 'ch-003',
      name: 'Mumbai Cinema Classics',
      category: 'Hindi',
      logo: '/api/assets/logo/mumbai-cinema.svg',
      stream_url: 'https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8',
      type: 'HLS',
      resolution: '1920x1080',
      codec: 'avc1.4d401f,mp4a.40.2',
      bandwidth: 4200000,
      tvg_id: 'mumbai.cinema.in',
      tvg_name: 'Mumbai Cinema Classics',
      group_title: 'Hindi',
      status: 'online',
      validation_status: 'ONLINE',
      latency_ms: 142,
      is_duplicate: false,
      drm_protected: false,
      last_checked: now,
    },
    {
      id: 'ch-004',
      name: 'Apex Global Sports 1',
      category: 'Sports',
      logo: '/api/assets/logo/apex-sports.svg',
      stream_url: 'https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8',
      type: 'HLS',
      resolution: '1920x1080',
      codec: 'avc1.640028,mp4a.40.2',
      bandwidth: 6100000,
      tvg_id: 'apex.sports1.global',
      tvg_name: 'Apex Global Sports 1',
      group_title: 'Sports',
      status: 'online',
      validation_status: 'ONLINE',
      latency_ms: 165,
      is_duplicate: false,
      drm_protected: false,
      last_checked: now,
    },
    {
      id: 'ch-005',
      name: 'World Chronicle English',
      category: 'English',
      logo: '/api/assets/logo/world-chronicle.svg',
      stream_url: 'https://cph-p2p-msl.akamaized.net/hls/live/2000341/test/master.m3u8',
      type: 'HLS',
      resolution: '1280x720',
      codec: 'avc1.4d401f,mp4a.40.2',
      bandwidth: 2800000,
      tvg_id: 'world.chronicle.uk',
      tvg_name: 'World Chronicle English',
      group_title: 'English',
      status: 'online',
      validation_status: 'ONLINE',
      latency_ms: 131,
      is_duplicate: false,
      drm_protected: false,
      last_checked: now,
    },
    {
      id: 'ch-006',
      name: 'Global Pulse News Desk',
      category: 'News',
      logo: '/api/assets/logo/pulse-news.svg',
      stream_url: 'https://moctobpltc-i.akamaihd.net/hls/live/571329/eight/playlist.m3u8',
      type: 'HLS',
      resolution: '1280x720',
      codec: 'avc1.4d401f,mp4a.40.2',
      bandwidth: 2450000,
      tvg_id: 'global.pulse.news',
      tvg_name: 'Global Pulse News Desk',
      group_title: 'News',
      status: 'online',
      validation_status: 'ONLINE',
      latency_ms: 184,
      is_duplicate: false,
      drm_protected: false,
      last_checked: now,
    },
    {
      id: 'ch-007',
      name: 'Studio Premiere Movies',
      category: 'Movies',
      logo: '/api/assets/logo/studio-movies.svg',
      stream_url: 'https://vod-cdn.authorized-ott.internal/movies/featured_1080p.mp4',
      type: 'MP4',
      resolution: '1920x1080',
      codec: 'h264,aac',
      bandwidth: 3800000,
      tvg_id: 'studio.premiere.mov',
      tvg_name: 'Studio Premiere Movies',
      group_title: 'Movies',
      status: 'online',
      validation_status: 'ONLINE',
      latency_ms: 76,
      is_duplicate: false,
      drm_protected: false,
      last_checked: now,
    },
    {
      id: 'ch-008',
      name: 'Junior Discovery Kids',
      category: 'Kids',
      logo: '/api/assets/logo/junior-kids.svg',
      stream_url: 'https://test-streams.mux.dev/pts_shift/master.m3u8',
      type: 'HLS',
      resolution: '1280x720',
      codec: 'avc1.42c01f,mp4a.40.2',
      bandwidth: 2100000,
      tvg_id: 'junior.discovery.kids',
      tvg_name: 'Junior Discovery Kids',
      group_title: 'Kids',
      status: 'online',
      validation_status: 'ONLINE',
      latency_ms: 129,
      is_duplicate: false,
      drm_protected: false,
      last_checked: now,
    },
    {
      id: 'ch-009',
      name: 'Acoustic Sessions Music TV',
      category: 'Music',
      logo: '/api/assets/logo/acoustic-music.svg',
      stream_url: 'https://edge-ts.authorized-ott.internal/live/music_ch09.ts',
      type: 'MPEG-TS',
      resolution: '1920x1080',
      codec: 'mpeg2video,mp2',
      bandwidth: 4500000,
      tvg_id: 'acoustic.music.tv',
      tvg_name: 'Acoustic Sessions Music TV',
      group_title: 'Music',
      status: 'online',
      validation_status: 'ONLINE',
      latency_ms: 95,
      is_duplicate: false,
      drm_protected: false,
      last_checked: now,
    },
    {
      id: 'ch-010',
      name: 'Dhaka Broadcast HD (Mirror)',
      category: 'Bangla',
      logo: '/api/assets/logo/dhaka-hd.svg',
      stream_url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
      type: 'HLS',
      resolution: '1920x1080',
      codec: 'avc1.640028,mp4a.40.2',
      bandwidth: 4605600,
      tvg_id: 'dhaka.hd.bd',
      tvg_name: 'Dhaka Broadcast HD',
      group_title: 'Bangla',
      status: 'online',
      validation_status: 'ONLINE',
      latency_ms: 121,
      is_duplicate: true,
      duplicate_of: 'ch-001',
      drm_protected: false,
      last_checked: now,
    },
    {
      id: 'ch-011',
      name: 'Legacy Transcoder Feed 4',
      category: 'International',
      logo: '/api/assets/logo/intl-feed.svg',
      stream_url: 'https://origin-west.authorized-ott.example/live/dead_channel/index.m3u8',
      type: 'HLS',
      resolution: 'Unknown',
      tvg_id: 'legacy.intl.04',
      tvg_name: 'Legacy Transcoder Feed 4',
      group_title: 'International',
      status: 'offline',
      validation_status: 'OFFLINE',
      latency_ms: 0,
      is_duplicate: false,
      drm_protected: false,
      last_checked: now,
    },
    {
      id: 'ch-012',
      name: 'Partner Restricted Feed (Auth Required)',
      category: 'Sports',
      logo: '/api/assets/logo/partner-sports.svg',
      stream_url: 'https://secure-partner.authorized-ott.example/protected/stream.m3u8',
      type: 'HLS',
      resolution: 'Unknown',
      tvg_id: 'partner.restricted.sports',
      tvg_name: 'Partner Restricted Feed',
      group_title: 'Sports',
      status: 'unauthorized',
      validation_status: 'UNAUTHORIZED',
      latency_ms: 64,
      is_duplicate: false,
      drm_protected: true,
      last_checked: now,
    },
  ];

  const initialSources: ScannedSourceRecord[] = [
    {
      id: 'src-001',
      url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
      source_origin: 'Primary OTT Playlist',
      http_status: 200,
      content_type: 'application/vnd.apple.mpegurl',
      response_size: 482,
      response_time_ms: 118,
      media_type: 'HLS',
      working_status: 'working',
      discovered_at: now,
    },
    {
      id: 'src-002',
      url: 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8',
      source_origin: 'Apple fMP4 Master Reference',
      http_status: 200,
      content_type: 'application/vnd.apple.mpegurl',
      response_size: 2840,
      response_time_ms: 94,
      media_type: 'M3U8',
      working_status: 'working',
      discovered_at: now,
    },
    {
      id: 'src-003',
      url: 'https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8',
      source_origin: 'Akamai Sintel Multi-Variant HLS',
      http_status: 200,
      content_type: 'application/x-mpegURL',
      response_size: 1620,
      response_time_ms: 142,
      media_type: 'HLS',
      working_status: 'working',
      discovered_at: now,
    },
    {
      id: 'src-004',
      url: 'https://vod-cdn.authorized-ott.internal/movies/featured_1080p.mp4',
      source_origin: 'Authorized VOD Storage Node',
      http_status: 200,
      content_type: 'video/mp4',
      response_size: 148500200,
      response_time_ms: 76,
      media_type: 'MP4',
      working_status: 'working',
      discovered_at: now,
    },
    {
      id: 'src-005',
      url: 'https://edge-ts.authorized-ott.internal/live/music_ch09.ts',
      source_origin: 'Authorized MPEG-TS Relay',
      http_status: 200,
      content_type: 'video/mp2t',
      response_size: 8388608,
      response_time_ms: 95,
      media_type: 'MPEG-TS',
      working_status: 'working',
      discovered_at: now,
    },
    {
      id: 'src-006',
      url: 'https://api.authorized-ott.internal/v1/channels.json',
      source_origin: 'CMS Channel Catalog API',
      http_status: 200,
      content_type: 'application/json',
      response_size: 19420,
      response_time_ms: 52,
      media_type: 'JSON_API',
      working_status: 'working',
      discovered_at: now,
    },
    {
      id: 'src-007',
      url: 'https://epg.authorized-ott.example/bangla.xml',
      source_origin: 'XMLTV Program Guide Feed',
      http_status: 200,
      content_type: 'application/xml',
      response_size: 84120,
      response_time_ms: 68,
      media_type: 'XML_API',
      working_status: 'working',
      discovered_at: now,
    },
    {
      id: 'src-008',
      url: 'https://origin-west.authorized-ott.example/live/dead_channel/index.m3u8',
      source_origin: 'Legacy West Origin',
      http_status: 404,
      content_type: 'text/plain',
      response_size: 0,
      response_time_ms: 310,
      media_type: 'M3U8',
      working_status: 'failed',
      error_message: 'HTTP 404 Not Found',
      discovered_at: now,
    },
    {
      id: 'src-009',
      url: 'https://secure-partner.authorized-ott.example/protected/stream.m3u8',
      source_origin: 'Partner Encrypted Feed',
      http_status: 401,
      content_type: 'application/json',
      response_size: 64,
      response_time_ms: 64,
      media_type: 'HLS',
      working_status: 'unauthorized',
      error_message: 'HTTP 401 Unauthorized — Access control respected',
      discovered_at: now,
    },
  ];

  const initialHlsAnalysis: HlsAnalysisReport = {
    id: 'hls-seed-001',
    master_url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    is_master_playlist: true,
    valid_syntax: true,
    recognized_tags: [
      '#EXTM3U',
      '#EXT-X-STREAM-INF',
      '#EXTINF',
      '#EXT-X-TARGETDURATION',
      '#EXT-X-ENDLIST',
    ],
    target_duration: 10,
    is_vod_endlist: true,
    drm_or_encrypted: false,
    variants: [
      {
        id: 'var-1080p',
        url: 'https://test-streams.mux.dev/x36xhzz/url_0/193039199_mp4_h264_aac_fhd_7.m3u8',
        resolution: '1920x1080',
        bandwidth: 4605600,
        codecs: 'avc1.640028,mp4a.40.2',
        target_duration: 10,
        is_endlist: true,
        drm_detected: false,
        segments: [
          {
            index: 1,
            duration: 10.0,
            url: 'https://test-streams.mux.dev/x36xhzz/url_0/193039199_mp4_h264_aac_fhd_7_001.ts',
            status: 'available',
          },
          {
            index: 2,
            duration: 10.0,
            url: 'https://test-streams.mux.dev/x36xhzz/url_0/193039199_mp4_h264_aac_fhd_7_002.ts',
            status: 'available',
          },
          {
            index: 3,
            duration: 10.0,
            url: 'https://test-streams.mux.dev/x36xhzz/url_0/193039199_mp4_h264_aac_fhd_7_003.ts',
            status: 'available',
          },
        ],
      },
      {
        id: 'var-720p',
        url: 'https://test-streams.mux.dev/x36xhzz/url_2/193039199_mp4_h264_aac_hd_7.m3u8',
        resolution: '1280x720',
        bandwidth: 2149280,
        codecs: 'avc1.4d401f,mp4a.40.2',
        target_duration: 10,
        is_endlist: true,
        drm_detected: false,
        segments: [
          {
            index: 1,
            duration: 10.0,
            url: 'https://test-streams.mux.dev/x36xhzz/url_2/193039199_mp4_h264_aac_hd_7_001.ts',
            status: 'available',
          },
          {
            index: 2,
            duration: 10.0,
            url: 'https://test-streams.mux.dev/x36xhzz/url_2/193039199_mp4_h264_aac_hd_7_002.ts',
            status: 'available',
          },
        ],
      },
      {
        id: 'var-480p',
        url: 'https://test-streams.mux.dev/x36xhzz/url_4/193039199_mp4_h264_aac_hq_7.m3u8',
        resolution: '848x480',
        bandwidth: 836280,
        codecs: 'avc1.42001e,mp4a.40.2',
        target_duration: 10,
        is_endlist: true,
        drm_detected: false,
        segments: [
          {
            index: 1,
            duration: 10.0,
            url: 'https://test-streams.mux.dev/x36xhzz/url_4/193039199_mp4_h264_aac_hq_7_001.ts',
            status: 'available',
          },
          {
            index: 2,
            duration: 10.0,
            url: 'https://test-streams.mux.dev/x36xhzz/url_4/193039199_mp4_h264_aac_hq_7_002.ts',
            status: 'available',
          },
        ],
      },
    ],
    audio_tracks: [
      {
        type: 'AUDIO',
        group_id: 'audio-stereo',
        name: 'English Stereo',
        language: 'en',
        default: true,
        autoselect: true,
      },
    ],
    subtitle_tracks: [
      {
        type: 'SUBTITLES',
        group_id: 'subs',
        name: 'English CC',
        language: 'en',
        default: true,
        autoselect: true,
      },
    ],
    total_segments: 7,
    analyzed_at: now,
  };

  // Authorized Source OTT Database tables for schema inspection & migration
  const authorizedDbTables: Record<string, Record<string, unknown>[]> = {
    ott_categories: [
      { id: 1, slug: 'bangla', title: 'Bangla', display_order: 1, active: true },
      { id: 2, slug: 'hindi', title: 'Hindi', display_order: 2, active: true },
      { id: 3, slug: 'english', title: 'English', display_order: 3, active: true },
      { id: 4, slug: 'sports', title: 'Sports', display_order: 4, active: true },
      { id: 5, slug: 'news', title: 'News', display_order: 5, active: true },
      { id: 6, slug: 'movies', title: 'Movies', display_order: 6, active: true },
      { id: 7, slug: 'kids', title: 'Kids', display_order: 7, active: true },
      { id: 8, slug: 'music', title: 'Music', display_order: 8, active: true },
    ],
    ott_channels: [
      {
        id: 101,
        category_id: 1,
        name: 'Dhaka Broadcast HD',
        stream_url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
        logo_url: '/api/assets/logo/dhaka-hd.svg',
        resolution: '1920x1080',
        ingest_token_secret: '************',
        status: 'online',
      },
      {
        id: 102,
        category_id: 1,
        name: 'Bangla Vision News 24',
        stream_url: 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8',
        logo_url: '/api/assets/logo/bv-news.svg',
        resolution: '1920x1080',
        ingest_token_secret: '************',
        status: 'online',
      },
      {
        id: 103,
        category_id: 2,
        name: 'Mumbai Cinema Classics',
        stream_url: 'https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8',
        logo_url: '/api/assets/logo/mumbai-cinema.svg',
        resolution: '1920x1080',
        ingest_token_secret: '************',
        status: 'online',
      },
      {
        id: 104,
        category_id: 4,
        name: 'Apex Global Sports 1',
        stream_url: 'https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8',
        logo_url: '/api/assets/logo/apex-sports.svg',
        resolution: '1920x1080',
        ingest_token_secret: '************',
        status: 'online',
      },
      {
        id: 105,
        category_id: 5,
        name: 'Global Pulse News Desk',
        stream_url: 'https://moctobpltc-i.akamaihd.net/hls/live/571329/eight/playlist.m3u8',
        logo_url: '/api/assets/logo/pulse-news.svg',
        resolution: '1280x720',
        ingest_token_secret: '************',
        status: 'online',
      },
    ],
    ott_epg_sources: [
      {
        id: 201,
        channel_id: 101,
        xmltv_url: 'https://epg.authorized-ott.example/bangla.xml',
        refresh_interval_min: 60,
        api_key_secret: '************',
      },
      {
        id: 202,
        channel_id: 104,
        xmltv_url: 'https://epg.authorized-ott.example/sports.xml',
        refresh_interval_min: 30,
        api_key_secret: '************',
      },
    ],
    ott_transcode_profiles: [
      { id: 301, profile_name: 'FHD_1080p_AVC', resolution: '1920x1080', bitrate_kbps: 4600, codec: 'h264' },
      { id: 302, profile_name: 'HD_720p_AVC', resolution: '1280x720', bitrate_kbps: 2400, codec: 'h264' },
      { id: 303, profile_name: 'SD_480p_AVC', resolution: '848x480', bitrate_kbps: 900, codec: 'h264' },
    ],
    ott_cdn_origins: [
      {
        id: 401,
        origin_name: 'Primary Edge Mux',
        hostname: 'test-streams.mux.dev',
        region: 'global',
        origin_secret_token: '************',
      },
      {
        id: 402,
        origin_name: 'Secondary Akamai Edge',
        hostname: 'bitdash-a.akamaihd.net',
        region: 'eu-central',
        origin_secret_token: '************',
      },
    ],
  };

  return {
    sources: initialSources,
    channels: initialChannels,
    hls_analyses: [initialHlsAnalysis],
    db_migrations: [],
    api_migrations: [],
    media_backups: [],
    checkpoints: [],
    audit_logs: [
      {
        id: 'aud-001',
        timestamp: now,
        operation: 'SCAN_SOURCE',
        actor: 'system-init',
        target: 'Authorized OTT Platform Inventory',
        status: 'SUCCESS',
        details: 'Initialized 9 authorized media sources and 12 channel records with SSRF protection active.',
      },
    ],
    authorized_db_tables: authorizedDbTables,
    target_db_tables: {
      ott_categories: [...authorizedDbTables.ott_categories],
      ott_channels: [...authorizedDbTables.ott_channels],
    },
  };
}

class PersistentDatabase {
  private state: AppDatabaseState;

  constructor() {
    this.state = this.loadFromDisk();
  }

  private loadFromDisk(): AppDatabaseState {
    try {
      if (fs.existsSync(DB_FILE_PATH)) {
        const raw = fs.readFileSync(DB_FILE_PATH, 'utf-8');
        const parsed = JSON.parse(raw) as AppDatabaseState;
        if (parsed && Array.isArray(parsed.channels)) {
          return parsed;
        }
      }
    } catch {
      // Fallback to initial seed state
    }
    const seed = createInitialSeedState();
    this.saveToDisk(seed);
    return seed;
  }

  private saveToDisk(stateToSave: AppDatabaseState = this.state): void {
    try {
      const tempPath = `${DB_FILE_PATH}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(stateToSave, null, 2), 'utf-8');
      fs.renameSync(tempPath, DB_FILE_PATH);
    } catch (err) {
      console.error('Failed to persist state to disk:', err);
    }
  }

  /**
   * Executes a synchronous transactional mutation on the database state.
   * Rolls back in-memory state if an error occurs.
   */
  public transaction<T>(fn: (draft: AppDatabaseState) => T): T {
    const snapshot = JSON.stringify(this.state);
    try {
      const result = fn(this.state);
      this.saveToDisk(this.state);
      return result;
    } catch (err) {
      this.state = JSON.parse(snapshot) as AppDatabaseState;
      throw err;
    }
  }

  public getState(): AppDatabaseState {
    return this.state;
  }

  public logAudit(
    operation: AuditLogEntry['operation'],
    target: string,
    status: AuditLogEntry['status'],
    details: string,
    actor = 'authorized-operator'
  ): AuditLogEntry {
    // Ensure no raw secrets ever leak into audit logs
    const safeTarget = target.replace(/(:\/\/[^:]+:)([^@]+)(@)/g, '$1************$3');
    const entry: AuditLogEntry = {
      id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      operation,
      actor,
      target: safeTarget,
      status,
      details,
    };

    this.state.audit_logs.unshift(entry);
    if (this.state.audit_logs.length > 500) {
      this.state.audit_logs = this.state.audit_logs.slice(0, 500);
    }
    this.saveToDisk();

    try {
      const logLine = `[${entry.timestamp}] [${entry.status}] [${entry.operation}] actor=${entry.actor} target="${entry.target}" details="${entry.details}"\n`;
      fs.appendFileSync(AUDIT_LOG_FILE_PATH, logLine, 'utf-8');
    } catch {
      // Ignore file append issues
    }

    return entry;
  }

  public getSanitizedAuthorizedTables(): Record<string, Record<string, unknown>[]> {
    const result: Record<string, Record<string, unknown>[]> = {};
    for (const [tableName, rows] of Object.entries(this.state.authorized_db_tables)) {
      result[tableName] = rows.map((r) => sanitizeRecord(r));
    }
    return result;
  }
}

export const db = new PersistentDatabase();
export { DATA_DIR, BACKUPS_DIR, EXPORTS_DIR, LOGS_DIR, maskSecret };
