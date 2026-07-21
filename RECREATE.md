# Arr Management Web UI

## Overview

A single-page web interface for managing Sonarr and Radarr: health status, download
queue, missing-content searches (manual and scheduled), bulk unmonitoring of
downloaded items with full undo history, Docker container restarts, and container
log viewing.

**Server:** `http://192.168.1.4:7664`

---

## Tech Stack

- Language/Framework: Python 3 + Flask
- Database: none — JSON files on disk (`config.json`, `unmonitor_log.json`)
- Key Dependencies: `flask`, `requests`
- Frontend: vanilla HTML/CSS/JS (no build step, no external assets)
- External APIs: Sonarr/Radarr API v3; Docker CLI (`docker restart`, `docker logs`)

---

## Features

- Service health status (auto-refreshes every 30s)
- Service status clock
- Download queue counts and detailed queue items
- Search missing episodes (Sonarr) and movies (Radarr)
- Automated (scheduled) missing search per service
  - Independent enable toggle and interval for Sonarr and Radarr
  - Intervals: 30m, 1h, 3h, 6h, 12h, 24h, 48h, 1 week
  - Background thread checks every 60s and fires searches that are due
  - Last-run timestamp persisted in `config.json`; UI shows "next in Xh Ym"
- Unmonitor downloaded episodes and completed series (Sonarr) and movies (Radarr)
  - Unmonitors individual episodes that have files
  - Unmonitors entire series when all episodes are downloaded
  - Undo buttons appear after each action for quick reversal
- Action History log (persisted to `unmonitor_log.json`)
  - Collapsible viewer with Sonarr/Radarr toggle
  - Shows exact movie titles, series names, season/episode numbers for each action
  - Shows status change direction (monitored -> unmonitored or vice versa)
  - Undo button on each past unmonitor entry to re-monitor those exact items
  - Expandable item lists (shows first 5, click to expand)
- Restart Docker containers
- Service log viewer with refresh/follow and optional regex filtering
- Settings panel for URLs, API keys, container names

---

## Prerequisites

- Python 3
- Flask, requests (installed in venv)
- Docker (for restart functionality)
- User running the app must be able to run `docker logs` (e.g., in `docker` group) for the Service Logs panel

---

## Environment Variables

None. All configuration lives in `config.json` and is editable from the Settings
panel in the UI. See [Data Files](#configjson) for the full key list.

---

## Port Configuration

- Port: 7664
- Registered in portctl as: arr-mgmt

---

## File Structure

```
/home/josh/Projects/arr-mgmt/
├── app.py                  # Flask backend (all API endpoints)
├── config.json             # Runtime config (URLs, API keys, container names)
├── unmonitor_log.json      # Persistent log of unmonitor/remonitor actions
├── requirements.txt        # Python dependencies (flask, requests)
├── arr-mgmt.service        # Systemd unit file
├── RECREATE.md             # This document
├── venv/                   # Python virtual environment
├── templates/
│   └── index.html          # Main UI template
└── static/
    ├── style.css           # Dark theme styles
    └── app.js              # Frontend logic
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Main UI |
| GET | `/api/status` | Health status for both services |
| GET | `/api/queue` | Queue counts |
| GET | `/api/queue/items` | Detailed queue items (limit param) |
| POST | `/api/sonarr/search` | Trigger missing episode search |
| POST | `/api/radarr/search` | Trigger missing movie search |
| GET | `/api/auto-search` | Scheduler state + allowed intervals |
| POST | `/api/auto-search` | Update scheduler enable/interval per service |
| POST | `/api/sonarr/restart` | Restart Sonarr container |
| POST | `/api/radarr/restart` | Restart Radarr container |
| POST | `/api/sonarr/unmonitor-downloaded` | Unmonitor downloaded episodes + completed series |
| POST | `/api/radarr/unmonitor-downloaded` | Unmonitor downloaded movies |
| POST | `/api/sonarr/remonitor` | Re-monitor episodes/series (undo) |
| POST | `/api/radarr/remonitor` | Re-monitor movies (undo) |
| GET | `/api/unmonitor-log` | Get action history (service filter param) |
| POST | `/api/unmonitor-log/undo/<id>` | Undo a specific log entry |
| GET | `/api/logs/<service>` | Docker container logs (lines param) |
| GET | `/api/config` | Get config (API keys masked) |
| POST | `/api/config` | Update config |

---

## Data Files

### config.json

Stores service URLs, API keys, Docker container names, and the automated search
schedule. Created on first save from the Settings panel; missing keys fall back to
`DEFAULT_CONFIG` in `app.py`.

| Key | Description | Example |
|-----|-------------|---------|
| `sonarr_url` | Sonarr base URL | `http://192.168.1.4:8989` |
| `sonarr_api_key` | Sonarr API key | `abc123...` |
| `radarr_url` | Radarr base URL | `http://192.168.1.4:7878` |
| `radarr_api_key` | Radarr API key | `abc123...` |
| `sonarr_container` | Sonarr Docker container name | `sonarr` |
| `radarr_container` | Radarr Docker container name | `radarr` |
| `auto_search_sonarr_enabled` | Scheduled episode search on/off | `true` |
| `auto_search_sonarr_interval_minutes` | Interval (must be an allowed value) | `60` |
| `auto_search_sonarr_last_run` | UTC ISO timestamp of last auto search | `2026-07-21T13:25:20+00:00` |
| `auto_search_radarr_enabled` | Scheduled movie search on/off | `true` |
| `auto_search_radarr_interval_minutes` | Interval (must be an allowed value) | `180` |
| `auto_search_radarr_last_run` | UTC ISO timestamp of last auto search | `2026-07-21T11:34:20+00:00` |

Allowed intervals (minutes): `30, 60, 180, 360, 720, 1440, 2880, 10080`. Any other
value is rejected by `POST /api/auto-search`.

**Note:** `config.json` contains live API keys but is not gitignored — avoid pasting
its contents into public issues or docs.

### unmonitor_log.json

Persistent action log. Each entry contains:
- `id` - Short unique ID for undo reference
- `timestamp` - UTC ISO timestamp
- `service` - "sonarr" or "radarr"
- `action` - "unmonitor" or "remonitor"
- `status_change` - Human-readable direction (e.g., "monitored -> unmonitored")
- `movies` - (Radarr) List of `{id, title}`
- `episodes` - (Sonarr) List of `{id, series, season, episode, title}`
- `series` - (Sonarr) List of `{id, title}` for series-level changes
- `movie_ids` / `episode_ids` / `series_ids` - Flat ID lists for API calls

---

## Automated Search Scheduler

Implemented in `app.py` (`auto_search_worker` / `check_and_run_auto_searches`):

- A daemon thread is started in the `__main__` block and loops every 60 seconds.
- On each tick, for each enabled service it compares `now - last_run` against the
  configured interval and, if due, POSTs `MissingEpisodeSearch` (Sonarr) or
  `MissingMoviesSearch` (Radarr) to the service's `/api/v3/command` endpoint.
- `last_run` is only updated when the command succeeds, so a failed/unreachable
  service is retried on the next tick.
- Config reads/writes are guarded by a `threading.Lock` so a scheduler write cannot
  clobber a concurrent Settings save.
- If `enabled` is on but `last_run` is null (never run), the first search fires
  within ~1 minute of startup — the UI shows "runs within ~1 min".

Because the thread starts under `if __name__ == "__main__":`, the scheduler only
runs when the app is launched directly (`python app.py`, as the systemd unit does).
It will **not** run under a WSGI server such as gunicorn without changes.

---

## Running the Project

```bash
# Development / direct run (scheduler enabled)
cd /home/josh/Projects/arr-mgmt
./venv/bin/python app.py

# Production (systemd, auto-start on boot)
sudo systemctl start arr-mgmt
```

The app binds `0.0.0.0:7664` with `debug=False`. There is no authentication — keep
it on the LAN.

---

## Setup from Scratch

```bash
mkdir -p /home/josh/Projects/arr-mgmt/{templates,static}
cd /home/josh/Projects/arr-mgmt

# Create virtual environment
python3 -m venv venv
./venv/bin/pip install flask requests

# Copy app.py, templates/index.html, static/style.css, static/app.js
# Copy arr-mgmt.service

# Test run
./venv/bin/python app.py
```

---

## Systemd Service (Auto-start on Boot)

### arr-mgmt.service

```ini
[Unit]
Description=Arr Management Web UI
After=network.target

[Service]
Type=simple
User=josh
WorkingDirectory=/home/josh/Projects/arr-mgmt
ExecStart=/home/josh/Projects/arr-mgmt/venv/bin/python /home/josh/Projects/arr-mgmt/app.py
Restart=always

[Install]
WantedBy=multi-user.target
```

### Install Service

```bash
sudo cp arr-mgmt.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now arr-mgmt
```

### Service Commands

```bash
sudo systemctl status arr-mgmt
sudo systemctl restart arr-mgmt
sudo systemctl stop arr-mgmt
sudo journalctl -u arr-mgmt -f
```

---

## Usage

1. Open `http://192.168.1.4:7664` in a browser
2. Enter Sonarr/Radarr URLs and API keys in Settings
3. Click Save Settings
4. Use buttons to search missing content or restart services
5. Optionally enable Automated Search, pick an interval per service, and click Save Schedule
6. Use Unmonitor Downloaded to bulk-unmonitor completed items
7. Expand Action History to review past changes or undo them
8. Review queue items and service logs as needed

Get API keys from: Settings > General > API Key (in each app)

---

## Troubleshooting

- **Buttons show "Working..." for a long time (Sonarr):** The unmonitor endpoint fetches episodes for every series sequentially. Large libraries take time.
- **Undo not available for old entries:** Log entries from before the detailed logging update only have IDs, not titles. Undo still works, but item names won't display.
- **Service logs empty:** Ensure the user running arr-mgmt is in the `docker` group (`sudo usermod -aG docker josh`).
- **Connection failed errors:** Verify Sonarr/Radarr URLs and API keys in Settings. Ensure the services are running.
- **Automated search never fires:** Confirm the toggle is saved (check `auto_search_*_enabled` in `config.json`), and that the app was started via `python app.py` — the scheduler thread does not start under a WSGI server. Check `journalctl -u arr-mgmt -f` and the target service's logs for the triggered command.
- **"Unsupported interval" when saving the schedule:** Only the intervals listed under [config.json](#configjson) are accepted; the UI dropdown is the source of truth.
- **Scheduler ran but nothing downloaded:** The search command was accepted by Sonarr/Radarr — check indexer results in the Service Logs panel; arr-mgmt only triggers the search.
