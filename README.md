# arr-mgmt

A lightweight Flask web UI for managing [Sonarr](https://sonarr.tv/) and [Radarr](https://radarr.tv/) instances from one dashboard.

![status](https://img.shields.io/badge/status-active-brightgreen) ![python](https://img.shields.io/badge/python-3-blue) ![license](https://img.shields.io/badge/license-MIT-green)

## What it does

One small dashboard that sits in front of your Sonarr + Radarr and gives you the things you actually do day-to-day:

- **Service health** — live status dots for both services, auto-refreshed
- **Queue at a glance** — counts + a detailed table of what's downloading
- **Search missing** — one-click "search for all missing episodes/movies", or schedule it automatically (30m → 1 week intervals)
- **Bulk unmonitor** — unmonitor already-downloaded episodes, completed series, or movies, with per-action undo
- **Action history** — persistent log of every unmonitor/remonitor with titles, timestamps, and undo buttons
- **Container restart** — restart the Sonarr/Radarr Docker containers from the UI
- **Log viewer** — tail Docker logs with optional regex filtering

## Tech stack

- Python 3 + Flask
- `requests` for talking to the Sonarr/Radarr v3 APIs
- Vanilla HTML/CSS/JS frontend (no build step)
- Optional: systemd unit for auto-start, Docker CLI on the host for container restart

## Prerequisites

- A running Sonarr and/or Radarr with API keys
- Either Docker (recommended) **or** Python 3.9+ for bare-metal install

## Deploy with Docker (recommended)

Prebuilt multi-arch images (`amd64` + `arm64`) are published to GitHub Container Registry on every push to `main` and on version tags.

### Example `docker-compose.yml`

```yaml
services:
  arr-mgmt:
    image: ghcr.io/gitsumhubs/arr-mgmt:latest
    container_name: arr-mgmt
    restart: unless-stopped
    ports:
      - "7664:7664"
    volumes:
      - ./data:/data
      # Persistent config + action history.
      - /var/run/docker.sock:/var/run/docker.sock
      # Needed so the app can restart the Sonarr/Radarr containers and tail their logs.
      # SECURITY: mounting the docker socket gives this container root-equivalent
      # access to the host. Remove this line if you don't need the restart/log-viewer
      # features — everything else (status, queue, search, unmonitor) still works.
    environment:
      - ARR_MGMT_DATA_DIR=/data
      - TZ=Etc/UTC
```

### Quick start

```bash
mkdir arr-mgmt && cd arr-mgmt
curl -O https://raw.githubusercontent.com/gitsumhubs/arr-mgmt/main/docker-compose.yml
docker compose up -d
```

Open `http://<host>:7664` and configure Sonarr/Radarr URLs + API keys in the Settings panel. Config and action history persist in `./data/` next to the compose file.

### Docker socket caveat

The default compose mounts `/var/run/docker.sock` so the app can restart Sonarr/Radarr containers and tail their logs from the UI. This gives the container root-equivalent access to the host — fine for a personal homelab, not appropriate for multi-tenant or untrusted environments. Remove the socket mount in `docker-compose.yml` if you don't need those features; everything else still works.

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ARR_MGMT_DATA_DIR` | `/data` | Where `config.json` and `unmonitor_log.json` are persisted |
| `ARR_MGMT_PORT` | `7664` | Port Flask binds inside the container |

## Deploy from source (bare metal)

```bash
git clone https://github.com/gitsumhubs/arr-mgmt.git
cd arr-mgmt

python3 -m venv venv
./venv/bin/pip install -r requirements.txt

cp config.example.json config.json
# edit config.json, or leave it blank and configure from the Settings panel on first run

./venv/bin/python app.py
```

Then open `http://localhost:7664`. For auto-start on boot, see `arr-mgmt.service` and [RECREATE.md](RECREATE.md#systemd-service-auto-start-on-boot).

## Configuration

All runtime config lives in `config.json` (gitignored). You can either edit it directly or use the Settings panel in the UI.

| Key | Description |
|-----|-------------|
| `sonarr_url` / `radarr_url` | Base URL of your Sonarr/Radarr instance |
| `sonarr_api_key` / `radarr_api_key` | API key from Settings → General |
| `sonarr_container` / `radarr_container` | Docker container name (for restart + logs) |
| `auto_search_*_enabled` | Toggle the automatic missing-content search |
| `auto_search_*_interval_minutes` | How often it runs (30, 60, 180, 360, 720, 1440, 2880, 10080) |

API keys are masked when returned from `/api/config` — send `***` back to keep the existing value.

## Docs

Full setup, file structure, API reference, and troubleshooting live in [RECREATE.md](RECREATE.md).

## License

MIT — see [LICENSE](LICENSE).
