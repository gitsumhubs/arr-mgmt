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
  - Unmonitors individual episodes that have files, everywhere, regardless of season
  - Specials (season 0) are ignored for every completion check below — a show/season
    with all regular episodes downloaded but no specials on disk still counts as done
  - Sonarr series with `status: "ended"`: once every non-special episode is downloaded,
    the whole series gets unmonitored (series-level flag off)
  - Sonarr series that are still airing (`status` is `"continuing"`/`"upcoming"`/
    anything other than `"ended"`): the series-level flag is never turned off, and
    **any** season that's fully downloaded — including the newest one — gets its
    season-level monitor flag turned off individually. A show's `"continuing"`
    status by itself does *not* protect a season; some shows (e.g. long-running kids
    shows) sit `"continuing"` indefinitely with no new content pending, so status
    alone was found to be an unreliable signal. Only actual incompleteness (below)
    keeps a season monitored.
  - Re-monitors any unmonitored season (excluding specials) that's missing at least
    one file and whose first episode aired on/after `SONARR_NEW_SEASON_MIN_YEAR`
    (currently `2025`, set in `app.py`) — catches a season Sonarr imported after the
    series was previously (fully) unmonitored, and is also what keeps a genuinely
    new/incoming season (one Sonarr has data for but hasn't downloaded yet)
    monitored instead of getting swept up by the retirement rule above. The
    "missing a file" requirement is what stops this from re-monitoring a season
    that's already fully downloaded and was correctly unmonitored just because it
    happens to have aired recently. Older seasons that happen to be unmonitored, or
    seasons on an `"ended"` show, are left alone.
  - Undo buttons appear after each action for quick reversal; season-only completions
    are only undoable from the Action History log (not the just-ran quick-undo
    button), and undo restores that specific season rather than the whole series
  - **Excluded shows:** a search box lets you pick any Sonarr series to fully exclude
    from both the button and the scheduled unmonitor — an excluded series is skipped
    before any of the logic above runs, so it's left exactly as you set it manually.
    Use case: a show where you only ever want the old seasons kept, with new seasons
    excluded from this app's auto-unmonitor/auto-remonitor behavior entirely.
    Exclusions are stored by Sonarr series ID in `config.json`
    (`sonarr_unmonitor_excluded_series`, list of `{id, title}`). If an excluded show
    is removed and re-added in Sonarr (new ID), the panel shows a notice with a
    one-click "Re-exclude" action when it can find a same-titled show currently in
    the library, or "no longer in Sonarr" when it can't.
- Automated (scheduled) unmonitor per service
  - Same interval choices and per-service toggles as automated search
  - Runs the identical logic as the manual button, on the same 60s worker
  - Scheduled runs are written to Action History tagged `scheduled` and stay undoable
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
| GET | `/api/auto-search` | Search scheduler state + allowed intervals |
| POST | `/api/auto-search` | Update search scheduler enable/interval per service |
| GET | `/api/auto-unmonitor` | Unmonitor scheduler state + allowed intervals |
| POST | `/api/auto-unmonitor` | Update unmonitor scheduler enable/interval per service |
| POST | `/api/sonarr/restart` | Restart Sonarr container |
| POST | `/api/radarr/restart` | Restart Radarr container |
| POST | `/api/sonarr/unmonitor-downloaded` | Unmonitor downloaded episodes + completed series, and re-monitor newly-imported seasons (see below) |
| POST | `/api/radarr/unmonitor-downloaded` | Unmonitor downloaded movies |
| GET | `/api/sonarr/series-list` | List all Sonarr series (id/title/year/status) for the exclusion search box |
| GET | `/api/sonarr/exclusions` | List current exclusions + any stale ones (removed/re-added series) |
| POST | `/api/sonarr/exclusions` | `{"action":"add","id","title"}` / `{"action":"remove","id"}` / `{"action":"swap","old_id","new_id","new_title"}` |
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
| `auto_unmonitor_sonarr_enabled` | Scheduled episode/series unmonitor on/off | `false` |
| `auto_unmonitor_sonarr_interval_minutes` | Interval (default `1440`) | `1440` |
| `auto_unmonitor_sonarr_last_run` | UTC ISO timestamp of last auto unmonitor | `null` |
| `auto_unmonitor_radarr_enabled` | Scheduled movie unmonitor on/off | `false` |
| `auto_unmonitor_radarr_interval_minutes` | Interval (default `1440`) | `1440` |
| `auto_unmonitor_radarr_last_run` | UTC ISO timestamp of last auto unmonitor | `null` |
| `sonarr_unmonitor_excluded_series` | List of `{id, title}` Sonarr series fully skipped by unmonitor (button + schedule) | `[]` |

Allowed intervals (minutes): `30, 60, 180, 360, 720, 1440, 2880, 10080`. Any other
value is rejected by `POST /api/auto-search` and `POST /api/auto-unmonitor`.

**Note:** `config.json` contains live API keys but is not gitignored — avoid pasting
its contents into public issues or docs.

### unmonitor_log.json

Persistent action log. Each entry contains:
- `id` - Short unique ID for undo reference
- `timestamp` - UTC ISO timestamp
- `service` - "sonarr" or "radarr"
- `action` - "unmonitor" or "remonitor"
- `status_change` - Human-readable direction (e.g., "monitored -> unmonitored")
- `source` - "manual" (UI button) or "scheduled" (background worker); Sonarr suffixes
  this for the two automated sub-cases: `_new_season` (waking up a newly-imported
  season) and `_season` (retiring one completed season on a still-airing show), e.g.
  `manual_season`, `scheduled_new_season`; entries written before this field existed
  have no `source` and display as manual
- `movies` - (Radarr) List of `{id, title}`
- `episodes` - (Sonarr) List of `{id, series, season, episode, title}`
- `series` - (Sonarr) List of `{id, title}` for series-level changes, or
  `{id, title, season}` when the entry is a season-only completion/wake-up (undo then
  restores just that season's monitor flag instead of the whole series)
- `movie_ids` / `episode_ids` / `series_ids` - Flat ID lists for API calls

---

## Schedulers

Two independent schedules — **automated search** and **automated unmonitor** — share
one generic implementation in `app.py`:

| Piece | Purpose |
|-------|---------|
| `SCHEDULED_TASKS` | Maps a config key prefix to its runner: `auto_search` -> `trigger_search`, `auto_unmonitor` -> `run_unmonitor` |
| `check_and_run_scheduled(prefix, runner)` | Runs the runner for each service whose schedule is due, then persists `last_run` |
| `scheduler_worker()` | Daemon thread; loops over every entry in `SCHEDULED_TASKS` and sleeps 60s |
| `schedule_state()` / `update_schedule()` | Back the `GET`/`POST` endpoints for both prefixes |

Behavior common to both:

- A daemon thread is started in the `__main__` block and loops every 60 seconds.
- On each tick, for each enabled service it compares `now - last_run` against the
  configured interval and runs the task if due.
- `last_run` is only updated when the task succeeds, so a failed/unreachable service
  is retried on the next tick.
- Config reads/writes are guarded by `config_lock`, and Action History writes by
  `log_lock`, so background runs cannot clobber concurrent UI actions.
- If `enabled` is on but `last_run` is null (never run), the task fires within
  ~1 minute of startup — the UI shows "runs within ~1 min".
- A corrupt/unparseable `last_run` is treated as "never run" rather than crashing.

Task-specific notes:

- **Search** POSTs `MissingEpisodeSearch` (Sonarr) or `MissingMoviesSearch` (Radarr)
  to the service's `/api/v3/command` endpoint.
- **Unmonitor** calls the same `perform_sonarr_unmonitor` / `perform_radarr_unmonitor`
  functions as the UI buttons, with `source="scheduled"` so Action History
  distinguishes them. Entries remain undoable exactly like manual ones.
- The Sonarr unmonitor makes one API call per series, so a large library can occupy
  the worker thread for minutes. Other scheduled tasks simply run on a later tick;
  nothing overlaps because a single thread drives all schedules.
- Default unmonitor interval is 1440 minutes (24h) versus 360 (6h) for search.

To add another scheduled task: add `<prefix>_<service>_enabled` /
`_interval_minutes` / `_last_run` keys to `DEFAULT_CONFIG`, register a
`runner(service, config) -> {"success": bool}` in `SCHEDULED_TASKS`, and expose
`schedule_state`/`update_schedule` routes for the prefix.

Because the thread starts under `if __name__ == "__main__":`, the schedulers only
run when the app is launched directly (`python app.py`, as the systemd unit does).
They will **not** run under a WSGI server such as gunicorn without changes.

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
7. Optionally enable Automated Unmonitor the same way to keep the library tidy on a schedule
8. Expand Action History to review past changes or undo them (scheduled runs are tagged)
9. Review queue items and service logs as needed

Get API keys from: Settings > General > API Key (in each app)

---

## Troubleshooting

- **Buttons show "Working..." for a long time (Sonarr):** The unmonitor endpoint fetches episodes for every series sequentially. Large libraries take time.
- **Undo not available for old entries:** Log entries from before the detailed logging update only have IDs, not titles. Undo still works, but item names won't display.
- **Service logs empty:** Ensure the user running arr-mgmt is in the `docker` group (`sudo usermod -aG docker josh`).
- **Connection failed errors:** Verify Sonarr/Radarr URLs and API keys in Settings. Ensure the services are running.
- **Automated search or unmonitor never fires:** Confirm the toggle is saved (check `auto_search_*_enabled` / `auto_unmonitor_*_enabled` in `config.json`), and that the app was started via `python app.py` — the scheduler thread does not start under a WSGI server. Check `journalctl -u arr-mgmt -f` and the target service's logs.
- **"Unsupported interval" when saving the schedule:** Only the intervals listed under [config.json](#configjson) are accepted; the UI dropdown is the source of truth.
- **Automated unmonitor re-runs on things you deliberately re-monitored:** The scheduled job applies the same rule as the button — anything monitored *and* downloaded gets unmonitored. If you re-monitor an already-downloaded item, the next scheduled run will unmonitor it again. Disable the schedule for that service or use a longer interval.
- **A previously-unmonitored show unexpectedly gets monitored again:** Sonarr unmonitor now also re-monitors any *incomplete* season (excluding specials) that first aired on/after `SONARR_NEW_SEASON_MIN_YEAR` and isn't monitored yet — this is by design, meant to catch newly-imported seasons on shows this app unmonitored earlier. It should never fire on a season that's already fully downloaded (that's the "incomplete" requirement); if it does, check whether `hasFile` is actually true for every episode in that season in Sonarr. To exempt a show permanently, unmonitor it manually in Sonarr and disable auto-unmonitor for it there, or raise `SONARR_NEW_SEASON_MIN_YEAR` in `app.py`.
- **A still-airing show never gets fully unmonitored, only some seasons do:** Expected — the series-level flag is only cleared once Sonarr reports the series `status` as `"ended"`. While a show is `"continuing"`/`"upcoming"`, every fully-downloaded season (including the newest) gets retired individually, but the series-level flag itself stays on.
- **A show never gets touched at all even though it looks finished:** Check the series' `status` field in Sonarr — if it hasn't been refreshed to `"ended"` yet (metadata provider lag), the app treats it as still airing: it'll still retire any fully-downloaded season, just not flip the series-level flag off. A manual series refresh in Sonarr usually fixes this.
- **A genuinely upcoming season (e.g. only 1 episode announced so far) keeps getting unmonitored:** This should only happen if that season is already fully downloaded relative to what Sonarr currently knows about it (e.g. that 1 known episode has a file) — the app can't tell "this is all there'll ever be" from "more episodes are coming but Sonarr hasn't added them yet." If this happens, exclude the show via the Excluded Shows list until the rest of the season lands in Sonarr.
- **A scheduled unmonitor took a long time / next tick was late:** Expected on large Sonarr libraries; the worker is single-threaded and the Sonarr scan is one API call per series.
- **Scheduler ran but nothing downloaded:** The search command was accepted by Sonarr/Radarr — check indexer results in the Service Logs panel; arr-mgmt only triggers the search.
