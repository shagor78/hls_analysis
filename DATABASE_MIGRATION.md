# Database Migration Protocol (`DATABASE_MIGRATION.md`)

StreamVault supports authorized schema inspection, backup, restore, and migration across:
* **PostgreSQL** (`postgresql://user:pass@host:5432/dbname`)
* **MySQL / MariaDB** (`mysql://user:pass@host:3306/dbname`)
* **SQLite** (`sqlite:///./data/authorized_source_ott.db`)

## Mandatory 9-Step Migration Workflow

1. **Detect Tables**: Connects using explicitly provided credentials and enumerates authorized tables.
2. **Show Table Names**: Displays `ott_categories`, `ott_channels`, `ott_epg_sources`, `ott_transcode_profiles`, and `ott_cdn_origins`.
3. **Show Row Counts**: Computes exact record counts per table prior to migration.
4. **Show Relationships**: Maps foreign keys (e.g., `ott_channels.category_id -> ott_categories.id`).
5. **Select Tables**: Allows the operator to choose specific tables to include in the migration batch.
6. **Create Pre-Migration Backup**: Writes an automatic snapshot to `backups/db-backup-<dialect>-<timestamp>.json`.
7. **Validate Schema Compatibility**: Checks primary keys, data types, and column nullability across source and target dialects.
8. **Perform Transactional Migration**: Executes migration inside an atomic transaction (`BEGIN ... COMMIT` with automatic rollback on failure) while masking sensitive columns (`password`, `token`, `api_key`, `secret`) as `************`.
9. **Verify Row Counts**: Compares post-migration target row counts against source row counts and records verification status in `migration-report.json`.
