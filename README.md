# StreamVault OTT / HLS Migration & Backup Suite

**Authorized Systems Only** — StreamVault is a production-ready OTT platform migration, HLS dependency analyzer, IPTV playlist parser, stream validator, and database/API backup utility designed for migrating and backing up **your own OTT infrastructure** or explicitly authorized media origins.

## Security & Authorization Mandate

* **Explicit Authorization Required**: Only scan, validate, or migrate servers, playlists, APIs, and databases that you own or have written authorization to administer.
* **No Access Control Bypass**: This tool never attempts to bypass authentication (`401`/`403`), DRM (`#EXT-X-KEY`, FairPlay, Widevine, PlayReady), CAPTCHA, WAF, or origin rate limits (`429`).
* **Zero Credential Harvesting**: Secret fields (`password`, `api_key`, `jwt`, `token`, `payment`, `private_key`) are automatically masked as `************` in UI views, exports, and logs.
* **SSRF Protection**: Server-side HTTP requests block loopback (`127.0.0.0/8`), RFC1918 private networks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), and cloud metadata endpoints (`169.254.169.254`) unless explicitly permitted by the system administrator.
* **Comprehensive Audit Trail**: Every scan, HLS analysis, validation batch, export, database backup, and migration job is recorded in `logs/audit.log`.

## Architecture Overview

```text
├── backend/              # Python FastAPI + SQLAlchemy + httpx reference service
├── scanner/              # SSRF guard, rate-limited worker pool, and multi-source scanner
├── parsers/              # M3U/M3U8 parser, category normalizer, and HLS dependency analyzer
├── validators/           # Concurrent stream validator with exponential backoff & syntax checks
├── database/             # Transactional data store, models, and audit logger
├── migrations/           # 9-step PostgreSQL/MySQL/SQLite & paginated API migration engine
├── exports/              # Media backup manager & JSON/CSV/M3U report generator
├── tests/                # 12-part automated test suite with sample test data
├── docs/                 # Detailed operational and security documentation
├── src/                  # Enterprise dark/light frontend dashboard & 10-step Migration Wizard
├── cli.ts                # Command-line interface (ott-tool)
└── server.ts             # Express + Vite full-stack server on port 3000
```

## Documentation Index

* [Installation Guide](INSTALL.md)
* [Configuration & Environment Variables](CONFIGURATION.md)
* [Command-Line Interface (`ott-tool`)](CLI.md)
* [REST API Reference](API.md)
* [Database Migration Protocol](DATABASE_MIGRATION.md)
* [Security Controls & SSRF Policy](SECURITY.md)
* [Troubleshooting Guide](TROUBLESHOOTING.md)
