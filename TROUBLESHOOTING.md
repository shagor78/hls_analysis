# Troubleshooting Guide (`TROUBLESHOOTING.md`)

## 1. URL Blocked by SSRF Protection

* **Symptom**: Scanner returns `SSRF Protection: Access to private or reserved IP is blocked.`
* **Cause**: By default, `ALLOW_PRIVATE_NETWORKS` is `false` to prevent Server-Side Request Forgery against internal infrastructure.
* **Resolution**: If you are migrating an authorized origin on a private LAN or VLAN (`10.x.x.x` or `192.168.x.x`), enable **Allow Private LAN Networks** in the Security Controls panel or set `ALLOW_PRIVATE_NETWORKS="true"` in `.env`.

## 2. Stream Marked as `UNAUTHORIZED`

* **Symptom**: Stream Validator shows `UNAUTHORIZED` (`HTTP 401` or `403`).
* **Cause**: The stream requires a signed CDN token or partner authorization header. By design, StreamVault never attempts to bypass access controls.
* **Resolution**: Supply an authorized token via the API Migration / Authorized Source configuration or verify CDN origin permissions on your media server.

## 3. Stream Marked as `INVALID_M3U8`

* **Symptom**: URL returns `HTTP 200`, but validation status is `INVALID_M3U8`.
* **Cause**: The server returned an HTML landing page or JSON payload instead of a playlist starting with `#EXTM3U`.
* **Resolution**: Inspect the Content-Type in the **Source Scanner** table and verify the direct `.m3u8` manifest URL.

## 4. Database Migration Rejected

* **Symptom**: Database migration returns an error requesting confirmation or valid connection scheme.
* **Resolution**: Ensure the connection string uses `sqlite://`, `postgresql://`, or `mysql://`, inspect the schema first (Steps 1–4), select at least one table, and check the explicit confirmation box before starting the migration.
