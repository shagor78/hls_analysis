# Installation Guide (`INSTALL.md`)

## Prerequisites

* **Node.js** 20+ (Node 22 recommended)
* **Python** 3.11+ (optional, for standalone FastAPI worker mode)
* **Docker & Docker Compose** (optional, for containerized deployment with PostgreSQL)

## 1. Local Installation

```bash
# Install Node dependencies
npm install

# Copy environment configuration template
cp .env.example .env

# Start the full-stack server on port 3000
npm run dev
```

## 2. Docker Compose Deployment

```bash
docker compose up --build -d
```

Persistent volumes are automatically mounted for:
* `./data` — Operational database and checkpoints
* `./backups` — Timestamped database and media archive snapshots
* `./exports` — Generated `.m3u`, `.json`, `.csv`, and `.sql` files
* `./logs` — Structured audit logs (`logs/audit.log`)

## 3. Running Automated Tests

```bash
npm test
```
