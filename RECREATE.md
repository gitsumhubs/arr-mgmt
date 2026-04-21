# Arr Management Web UI

A web interface for managing Sonarr and Radarr.

---

## Features

- Service health status (auto-refreshes every 30s)
- Service status clock
- Download queue counts and detailed queue items
- Search missing episodes (Sonarr) and movies (Radarr)
- Automated search scheduler with per-service interval (30m, 1h, 3h, 6h, 12h, 24h, 48h, 1 week)
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

## Requirements

- Python 3
- Flask, requests (installed in venv)
- Docker (for restart functionality)
- User running the app must be able to run `docker logs` (e.g., in `docker` group) for the Service Logs panel

---

## Default Port

`7664` — change in `app.py` (`app.run(..., port=7664)`) if needed.

---

## File Structure

```
arr-mgmt/
├── app.py                  # Flask backend (all API endpoints)
├── config.example.json     # Template config — copy to config.json and fill in
├── config.json             # Runtime config (gitignored; holds URLs, API keys, container names)
├── unmonitor_log.json      # Persistent log of unmonitor/remonitor actions (gitignored)
├── requirements.txt        # Python dependencies (flask, requests)
├── arr-mgmt.service        # Systemd unit file (template — edit User/WorkingDirectory)
├── README.md
├── RECREATE.md
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
| GET | `/api/auto-search` | Get auto-search schedule for both services |
| POST | `/api/auto-search` | Update auto-search schedule |

---

## Data Files

### config.json

Stores service URLs, API keys, and Docker container names. Created on first save from the Settings panel. Not committed to git — copy `config.example.json` to `config.json` to start.

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

## Setup from Scratch

```bash
git clone <your-fork-url> arr-mgmt
cd arr-mgmt

# Create virtual environment
python3 -m venv venv
./venv/bin/pip install -r requirements.txt

# Copy the example config and edit with your Sonarr/Radarr URLs + API keys
cp config.example.json config.json
# (then edit config.json, or configure via the Settings UI on first run)

# Test run
./venv/bin/python app.py
```

Visit `http://localhost:7664` in a browser.

---

## Systemd Service (Auto-start on Boot)

Edit `arr-mgmt.service` — replace `YOUR_USER` and `/opt/arr-mgmt` with your values:

```ini
[Unit]
Description=Arr Management Web UI
After=network.target

[Service]
Type=simple
User=YOUR_USER
WorkingDirectory=/opt/arr-mgmt
ExecStart=/opt/arr-mgmt/venv/bin/python /opt/arr-mgmt/app.py
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

1. Open `http://localhost:7664` (or your host:port) in a browser
2. Enter Sonarr/Radarr URLs and API keys in Settings
3. Click Save Settings
4. Use buttons to search missing content or restart services
5. Use Unmonitor Downloaded to bulk-unmonitor completed items
6. Expand Action History to review past changes or undo them
7. Review queue items and service logs as needed

Get API keys from: Settings > General > API Key (in each app)

---

## Troubleshooting

- **Buttons show "Working..." for a long time (Sonarr):** The unmonitor endpoint fetches episodes for every series sequentially. Large libraries take time.
- **Undo not available for old entries:** Log entries from before the detailed logging update only have IDs, not titles. Undo still works, but item names won't display.
- **Service logs empty:** Ensure the user running arr-mgmt is in the `docker` group (`sudo usermod -aG docker <user>`).
- **Connection failed errors:** Verify Sonarr/Radarr URLs and API keys in Settings. Ensure the services are running.
