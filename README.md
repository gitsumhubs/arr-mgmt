# Arr Management Web UI

Arr Management is a Flask web interface for monitoring and managing Sonarr and
Radarr, including searches, queue status, scheduled jobs, unmonitoring, undo
history, container restarts, and service logs.

## Tech stack

- Python 3, Flask, and Requests
- Vanilla HTML, CSS, and JavaScript
- Optional Docker deployment with GHCR and GitHub Actions

## Prerequisites

- Python 3.12+ for a bare-metal install, or Docker Engine and Compose
- Sonarr and Radarr API keys
- Docker socket access for restart and log features

## Setup

```bash
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
./venv/bin/python app.py
```

For Docker, use the included Compose file:

```bash
docker compose pull
docker compose up -d
```

## Running

Open `http://<server>:7664`. Pushes to `main` build and publish
`ghcr.io/gitsumhubs/arr-mgmt:latest`; pull and recreate the service to deploy a
new image.

## Features

- Sonarr/Radarr health and queue views
- Manual and scheduled missing-content searches
- Downloaded-item unmonitoring with undo history
- Restores series and season monitoring for eligible missing seasons, including
  new seasons whose episodes Sonarr already monitors
- Per-show Sonarr exclusions
- Docker restart and log controls

## Configuration

Runtime settings are stored in `config.json`. In Docker, `ARR_MGMT_DATA_DIR` is
set to `/data` by Compose. Do not commit API keys to public repositories.

## Tests

Run the Sonarr monitoring regression suite without contacting live services:

```bash
./venv/bin/python -m unittest discover -s tests -v
```
