# REST API Reference (`API.md`)

All endpoints run under `/api/*` on port 3000 and log operations to `logs/audit.log`.

## 1. State & Reports

* `GET /api/state` — Returns full dashboard telemetry, channels, sources, HLS dependency reports, database schemas, migration jobs, and audit logs.
* `GET /api/reports/all` — Generates and returns `scan-report.json`, `scan-report.csv`, `migration-report.json`, `failed-streams.csv`, `channels.m3u`, and `channels.json`.
* `GET /api/export/:filename` — Downloads `channels.m3u`, `channels.json`, `channels.csv`, `failed-streams.csv`, or category playlists (`bangla.m3u`, `hindi.m3u`, `english.m3u`, `sports.m3u`, `news.m3u`).

## 2. Source Scanner & HLS Analyzer

* `POST /api/scan` — Scans an authorized Website URL, API URL, M3U/M3U8 URL, HLS URL, or local playlist upload.
* `POST /api/hls/analyze` — Parses Master & Variant `.m3u8` manifests and builds a segment dependency tree.
* `POST /api/m3u/parse` — Parses `#EXTM3U` / `#EXTINF` playlists, normalizes categories, and detects duplicates.
* `POST /api/validate` — Runs bulk stream validation (`ONLINE`, `OFFLINE`, `TIMEOUT`, `INVALID_M3U8`, `UNAUTHORIZED`, `SERVER_ERROR`).

## 3. Authorized Database & API Migration

* `POST /api/db/inspect` — Inspects authorized PostgreSQL, MySQL/MariaDB, or SQLite tables, row counts, and foreign keys.
* `POST /api/db/backup` — Creates a timestamped database backup in `backups/`.
* `POST /api/db/restore` — Restores database tables from a backup snapshot.
* `POST /api/db/generate-sql` — Generates SQL DDL + DML migration scripts.
* `POST /api/db/migrate` — Executes the 9-step transactional database migration with row count verification.
* `POST /api/api-migration/run` — Runs paginated `GET`/`POST` JSON/XML API migration with masked credentials (`************`).
* `POST /api/media-backup/run` — Archives media resources in `Metadata Only` or `Media Archive` mode (`Playlist backup` vs `Segment recording`).
