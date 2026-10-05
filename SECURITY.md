# Security Policy & Controls (`SECURITY.md`)

## 1. Authorized Systems Only

StreamVault is engineered strictly for administrators migrating, backing up, or monitoring their **own OTT platform** or media origins where they hold explicit authorization.

## 2. Non-Negotiable Security Invariants

* **No Authentication or DRM Bypass**: When an origin returns `HTTP 401 Unauthorized` or `HTTP 403 Forbidden`, the validator and scanner immediately record `UNAUTHORIZED` and stop. Retry loops and header spoofing are strictly disabled for `401`/`403` responses. Encrypted HLS streams (`#EXT-X-KEY` with `AES-128`, `SAMPLE-AES`, FairPlay, or Widevine) are flagged as protected and never decrypted.
* **SSRF Prevention**: `scanner/ssrf_guard.ts` validates every URL and DNS resolution before opening a socket. Connections to `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16` (cloud metadata service), and IPv6 loopback/unique-local addresses are blocked unless `ALLOW_PRIVATE_NETWORKS=true` is explicitly configured by the administrator.
* **Secret Masking**: Database connection passwords, Bearer tokens, API keys, and sensitive database columns (`password_hash`, `ingest_token_secret`, `api_key_secret`, `origin_secret_token`) are masked as `************` in all API responses, exports, and audit logs.
* **No SQL Injection or Exploit Payloads**: Database connection strings and table identifiers are strictly validated against an allowlist of schemas and table definitions.
* **Immutable Audit Logging**: Every scan, validation, export, backup, and migration action is logged with timestamp, actor, target, status, and summary in `logs/audit.log`.
