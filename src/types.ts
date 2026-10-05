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
  operation: string;
  actor: string;
  target: string;
  status: 'SUCCESS' | 'WARNING' | 'BLOCKED' | 'ERROR';
  details: string;
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

export interface SecurityConfig {
  allowPrivateNetworks: boolean;
  urlAllowlist: string[];
  rateLimitRps: number;
  timeoutMs: number;
  maxRetries: number;
  concurrency: number;
}

export interface AppStateResponse {
  summary: ComprehensiveReportSummary;
  securityConfig: SecurityConfig;
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
