# Configuration Reference (`CONFIGURATION.md`)

All sensitive credentials and operational thresholds are configured via environment variables in `.env` (see `.env.example`).

| Variable | Default | Description |
| :--- | :--- | :--- |
| `OTT_ENV` | `production` | Runtime environment (`development` or `production`) |
| `DATABASE_URL` | `sqlite:///./data/ott_migration.db` | Primary operational state database |
| `SOURCE_DB_URL` | `sqlite:///./data/authorized_source_ott.db` | Default authorized source database connection |
| `TARGET_DB_URL` | `sqlite:///./data/authorized_target_ott.db` | Default authorized target database connection |
| `ALLOW_PRIVATE_NETWORKS` | `false` | When `false`, blocks RFC1918, loopback, and link-local IPs (SSRF protection) |
| `URL_ALLOWLIST` | *(empty)* | Optional comma-separated list of permitted origin domains |
| `AUDIT_LOG_PATH` | `./logs/audit.log` | File path for immutable security and operational audit logs |
| `DEFAULT_TIMEOUT_MS` | `8000` | Default HTTP connection timeout in milliseconds |
| `DEFAULT_MAX_RETRIES` | `3` | Maximum retry attempts using exponential backoff (`300ms`, `600ms`, `1200ms`) |
| `DEFAULT_CONCURRENCY` | `5` | Concurrent worker pool size for stream validation and scanning |
| `DEFAULT_RATE_LIMIT_RPS` | `10` | Maximum outbound requests per second |
