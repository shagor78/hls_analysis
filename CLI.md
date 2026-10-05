# CLI Reference (`CLI.md`)

StreamVault includes the `ott-tool` CLI (`npx tsx cli.ts <command>` or via the in-app CLI console).

## Core Commands

```bash
# 1. Scan an authorized OTT website, API, M3U, or HLS URL
ott-tool scan https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8

# 2. Analyze an HLS Master/Variant M3U8 playlist and print the dependency tree
ott-tool analyze https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8

# 3. Validate all streams in a playlist or catalog
ott-tool validate playlist.m3u --timeout 5000 --retries 2 --concurrency 5

# 4. Export normalized channels to M3U, JSON, or CSV
ott-tool export channels.m3u --format m3u --output channels.m3u

# 5. Create a pre-migration database backup
ott-tool backup database

# 6. Execute the 9-step authorized database migration
ott-tool migrate database

# 7. Generate JSON summary report
ott-tool report --format json
```

## Supported Flags

* `--timeout <ms>`: Request timeout in milliseconds (default: `8000`)
* `--retries <n>`: Exponential backoff retries for transient network errors (default: `3`)
* `--concurrency <n>`: Concurrent worker threads (default: `5`)
* `--rate-limit <rps>`: Maximum outbound requests per second (default: `10`)
* `--output <filename>`: Target filename in `exports/`
* `--format <json|m3u|csv|text>`: Output format
