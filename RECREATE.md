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
- Layout: centered content and blue panels cap at 1050px wide and shrink to fit
  smaller screens with the existing 20px outer padding.
- Release version: `APP_VERSION` in `app.py` (currently `1.1.0`), rendered as a
  badge beside the page title. Bump this constant for each release; versioned
  stylesheet/script URLs also refresh browser assets when the release changes.
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
  - Unmonitors individual episodes that have files, except specials belonging to
    shows selected in the separate Specials Exceptions section
  - Specials (season 0) are ignored for every completion check below — a show/season
    with all regular episodes downloaded but no specials on disk still counts as done
  - Sonarr's series `status` field (`"continuing"`/`"ended"`/etc.) is **not** used
    for any of this — it turned out to be an unreliable signal (some shows, e.g.
    long-running kids shows, sit `"continuing"` indefinitely with no new content
    ever pending). Only actual completeness of what Sonarr currently has data for
    is used:
    - Once every known non-special episode is downloaded, the **whole series**
      gets unmonitored (series-level flag off) — regardless of status, unless it
      has a saved specials exception and a Specials season to keep enabled. This is
      safe for a still-airing show too, because a genuinely incomplete season
      (see below) takes priority and would have kept it out of this branch.
    - If only some seasons are complete, those are retired individually
      (season-level monitor flag off, including the newest season if it's the one
      that's complete) while the incomplete one is left untouched.
  - Restores monitoring for an incomplete season (excluding specials) if its
    season's first episode aired on/after `SONARR_NEW_SEASON_MIN_YEAR` (currently
    `2020`, set in `app.py`) and monitoring is off at the series, season, or
    missing-episode level. The series and season flags are checked independently
    of the episode flags: Sonarr can add a monitored new season and monitored
    episodes under a previously unmonitored series, which still blocks automatic
    downloads until the series flag is restored. This catches a season Sonarr imported
    after the series was previously (fully) unmonitored, including one that shows
    up long after that (there's no rolling time window — `SONARR_NEW_SEASON_MIN_YEAR`
    is a floor, so this keeps working indefinitely into the future). Only the
    missing episode(s) themselves get reactivated — **never** their
    already-downloaded siblings in the same season, even though the season as a
    whole still counts as "incomplete." Reactivating every unmonitored episode in
    an incomplete season (not just the actually-missing ones) was a real bug that
    caused already-downloaded episodes to flip-flop between monitored/unmonitored
    on alternating runs — unmonitored (correctly, per-episode) one run, then swept
    up again by this rule the next run because their season still had one missing
    episode, then unmonitored again, forever. Now the two rules only ever act on
    disjoint sets of episodes, so it's fully idempotent: a second run back-to-back
    makes zero changes. Older missing episodes (season's first episode before
    `SONARR_NEW_SEASON_MIN_YEAR`) that happen to be unmonitored are left alone unless
    that show has a saved year exception in the Season Monitor Audit Exceptions —
    this only ever *reactivates* something, never unmonitors a missing episode.
  - **Season Monitor Audit Exceptions:** a collapsible area directly below the unmonitor
    buttons. Open it to load saved exceptions without scanning Sonarr, then click
    **Run Audit** to find shows with missing episodes in seasons starting before
    `SONARR_NEW_SEASON_MIN_YEAR` or without air dates. Shows and per-season missing
    counts can be filtered by title. Scans are read-only; no monitoring is changed.
    Checking a show automatically saves a `{id, title}` exception in
    `sonarr_remonitor_ignore_year_series`. On the next manual or scheduled Sonarr
    unmonitor run, that show bypasses only the year requirement, so missing episodes
    in older or undated seasons can be re-monitored. Downloaded episodes remain
    unmonitored, specials remain outside season recovery, and both exclusion modes
    still take priority. Completed shows are still unmonitored as before.
    Unchecking restores the cutoff for future runs; it does not unmonitor episodes
    reactivated by a previous run. Saved exceptions remain visible after gaps are
    filled, with notices for excluded or removed shows. Removed/re-added shows need
    a fresh selection for their new Sonarr ID; exceptions are never matched by title.
    Failed series reads are listed as an incomplete audit so the scan can be retried.
  - Undo buttons appear after each action for quick reversal; season-only completions
    are only undoable from the Action History log (not the just-ran quick-undo
    button), and undo restores that specific season rather than the whole series
  - **Excluded shows:** a search box lets you pick any Sonarr series to override the
    normal rules, with a mode per show:
    - **Exclude entirely** (default): skipped before any of the logic above runs, so
      it's left exactly as you set it manually. Use case: a show where you only
      ever want the old seasons kept, with new seasons excluded from this app's
      auto-unmonitor/auto-remonitor behavior entirely.
    - **Latest season only**: every season except the show's newest is
      force-unmonitored (season + all its episodes) regardless of completeness,
      while the newest season follows the normal rules above as if it were the
      show's only season. Use case: a show with many old seasons you don't have
      and don't want chased (e.g. an annual series with 20+ years of gaps), but
      you still want the current season followed and searched for.
    Exclusions are stored by Sonarr series ID in `config.json`
    (`sonarr_unmonitor_excluded_series`, list of `{id, title, mode}` — `mode` is
    `"exclude"` or `"latest_only"`, omitted/missing means `"exclude"`). Change a
    show's mode any time via the dropdown next to it in the list — no need to
    remove and re-add. If an excluded show is removed and re-added in Sonarr (new
    ID), the panel shows a notice with a one-click "Re-exclude" action (carrying
    over its mode) when it can find a same-titled show currently in the library,
    or "no longer in Sonarr" when it can't.
- Automated (scheduled) unmonitor per service
  - Same interval choices and per-service toggles as automated search
  - Runs the identical logic as the manual button, on the same 60s worker
  - Scheduled runs are written to Action History tagged `scheduled` and stay undoable
- **Specials:** a separate manual action, **Apply Specials Rules & Search**,
  unmonitors all season-0 episodes (both missing and downloaded) and disables the
  Specials season, except for shows selected under **Specials Exceptions**.
  - Open the exceptions area to load saved selections without contacting Sonarr;
    **Load Specials** performs a read-only scan listing each show's total/missing
    specials. Filter by show title and check boxes to auto-save exceptions.
  - Selections are stored by current Sonarr ID in `sonarr_specials_exceptions`
    as `{id, title}`. Saving/removing a selection does not change Sonarr immediately;
    run the Specials action to apply it. Stale saved IDs remain removable offline.
  - Selected shows have their parent series, season 0, and all specials enabled,
    including already-downloaded specials. Only missing specials are searched,
    using targeted `EpisodeSearch` commands with explicit episode IDs. See the
    [upstream Sonarr command](https://github.com/Sonarr/Sonarr/blob/develop/src/NzbDrone.Core/IndexerSearch/EpisodeSearchCommand.cs).
  - This section's exceptions operate independently of the regular unmonitor
    action's Excluded Shows and year cutoff. Regular episode/season flags are not
    changed by the Specials action. Enabling the parent show is necessary for its
    specials and may also activate already-monitored regular episodes.
  - The regular Sonarr unmonitor button and schedule skip downloaded specials on
    exception shows and retire completed regular seasons individually, keeping the
    parent series monitored for specials. They do not search for specials.
  - Successful episode/season changes are recorded in Action History with source
    `manual_specials`; partial failures are returned explicitly with completed
    counts. Failed episode/parent updates never trigger searches for that show.
    Clicking again retries failed steps and queues another search for missing
    specials on exception shows. This action has no automatic schedule.
  - A shared backend lock serializes Specials actions with manual/scheduled
    regular Sonarr monitoring passes so their full-series updates cannot restore
    stale season flags over one another. Requests may wait for the active pass.
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

| Variable | Description | Example |
|----------|-------------|---------|
| `ARR_MGMT_DATA_DIR` | Directory for `config.json` and `unmonitor_log.json` | `/data` |
| `TZ` | Container timezone | `Etc/UTC` |

When unset, `ARR_MGMT_DATA_DIR` defaults to the application directory. All
configuration lives in `config.json` and is editable from the Settings panel.

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
├── Dockerfile              # Production container image
├── docker-compose.yml      # GHCR deployment definition
├── .github/workflows/      # GHCR build and publish workflow
├── tests/                  # Sonarr monitoring regression tests (unittest)
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
| GET | `/api/sonarr/monitoring-audit` | Saved year exceptions; add `?scan=true` for a read-only scan of older/undated incomplete seasons, plus `failed_series` warnings |
| POST | `/api/sonarr/monitoring-audit` | Save/remove a year exception with `{"id": 86, "enabled": true}`; validates current Sonarr ID on enable, permits offline removal |
| GET | `/api/sonarr/specials` | Saved specials exceptions; add `?scan=true` for read-only season-0 counts, current shows, stale IDs and partial scan errors |
| POST | `/api/sonarr/specials` | Save/remove a specials exception with `{"id": 86, "enabled": true}`; no immediate monitoring or search |
| POST | `/api/sonarr/specials/apply` | Unmonitor specials by default; monitor specials/show/season for exceptions and search their missing episode IDs; returns successful counts and explicit errors |
| GET | `/api/sonarr/exclusions` | List current exclusions + any stale ones (removed/re-added series) |
| POST | `/api/sonarr/exclusions` | `{"action":"add","id","title","mode"?}` / `{"action":"remove","id"}` / `{"action":"swap","old_id","new_id","new_title"}` / `{"action":"set_mode","id","mode"}` — `mode` is `"exclude"` (default) or `"latest_only"` |
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
| `sonarr_unmonitor_excluded_series` | List of `{id, title, mode}` Sonarr series overrides for unmonitor (button + schedule); `mode` is `"exclude"` (fully skipped) or `"latest_only"` (only newest season follows normal rules) | `[]` |
| `sonarr_remonitor_ignore_year_series` | List of `{id, title}` exceptions selected in the audit; bypasses the season-year cutoff on manual and scheduled Sonarr unmonitor runs, respecting exclusions | `[]` |
| `sonarr_specials_exceptions` | List of `{id, title}` shows whose specials should be monitored/searched by the Specials action and protected from the regular downloaded unmonitor action | `[]` |

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
portctl list
portctl status
sudo systemctl start arr-mgmt

# Stop / status / logs
sudo systemctl stop arr-mgmt
systemctl status arr-mgmt
journalctl -u arr-mgmt -n 100 --no-pager
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

# Check and register the port before starting a new installation
portctl check 7664
portctl allocate 7664 arr-mgmt

# Test run
./venv/bin/python app.py
```

### Docker Deployment

The image is published by `.github/workflows/docker-publish.yml` on every push
to `main`. The Compose deployment mounts `/docker/arr-mgmt` at `/data` for
persistent runtime state and mounts the Docker socket for restart and log
features. After a new image is published, run this on the deployment host:

```bash
cd /docker/arr-mgmt
docker compose pull
docker compose up -d
docker compose ps
```

The Compose service uses `pull_policy: always` and `restart: unless-stopped`.

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

## Testing

The regression tests use an in-memory Sonarr API and temporary action history;
they do not read API keys or alter the live library.

```bash
./venv/bin/python -m unittest discover -s tests -v
```

Coverage includes missing episodes whose parent series or season is unmonitored,
repeat-run idempotence, partially downloaded seasons, completed-series retirement,
the year floor, fully excluded shows, and latest-season-only exclusions.
Audit coverage also checks read-only discovery, per-show year exceptions,
saved-selection persistence/removal, invalid requests, and partial scan failures.
Specials tests cover default/exception rules, parent/season restoration, searches
limited to missing specials, regular-season isolation, protection from regular
unmonitor runs (including an empty Specials season), offline removal, history,
and read/write/search failures. Tests use temporary config/history and no live API.
An interleaved action/scheduler regression checks that a Specials update cannot
restore a regular season retired by the scheduled unmonitor pass.

## Troubleshooting

- **Buttons show "Working..." for a long time (Sonarr):** The unmonitor endpoint fetches episodes for every series sequentially. Large libraries take time.
- **Undo not available for old entries:** Log entries from before the detailed logging update only have IDs, not titles. Undo still works, but item names won't display.
- **Service logs empty:** Ensure the user running arr-mgmt is in the `docker` group (`sudo usermod -aG docker josh`).
- **Connection failed errors:** Verify Sonarr/Radarr URLs and API keys in Settings. Ensure the services are running.
- **Automated search or unmonitor never fires:** Confirm the toggle is saved (check `auto_search_*_enabled` / `auto_unmonitor_*_enabled` in `config.json`), and that the app was started via `python app.py` — the scheduler thread does not start under a WSGI server. Check `journalctl -u arr-mgmt -f` and the target service's logs.
- **"Unsupported interval" when saving the schedule:** Only the intervals listed under [config.json](#configjson) are accepted; the UI dropdown is the source of truth.
- **Automated unmonitor re-runs on things you deliberately re-monitored:** The scheduled job applies the same rule as the button — anything monitored *and* downloaded gets unmonitored. If you re-monitor an already-downloaded item, the next scheduled run will unmonitor it again. Disable the schedule for that service or use a longer interval.
- **A previously-unmonitored show unexpectedly gets monitored again:** Sonarr unmonitor also re-monitors incomplete regular seasons that started on/after `SONARR_NEW_SEASON_MIN_YEAR`, or any incomplete regular season on a show selected in the Season Monitor Audit Exceptions. Check the audit's saved exceptions for older shows. Unchecking an exception restores the cutoff on future runs without undoing previous changes. Excluded Shows / Exclude entirely protects against the regular unmonitor action; the separate Specials action uses its own exceptions. Specials exceptions also enable the parent series and keep it enabled across regular unmonitor runs. Regular-season recovery never applies to fully downloaded seasons; check Sonarr's `hasFile` values if a season seems complete but is being recovered.
- **A still-airing show never gets fully unmonitored, only some seasons do:** Expected when it has at least one genuinely incomplete season — the series-level flag only clears once every known non-special episode is downloaded. If it has no incomplete season at all and still isn't fully unmonitored, check for a stray monitored-but-not-downloaded episode Sonarr will never actually get (a permanently missing one) — that alone blocks the whole-series unmonitor and falls back to per-season retirement instead.
- **A show's already-downloaded episodes keep alternating monitored/unmonitored on every run:** This was a real bug (fixed) where the wake-up rule reactivated every unmonitored episode in a season just because that season also had one genuinely missing episode. Confirm the fix took by running the button twice back-to-back — the second run's `count` in the response should be `0` for a stable library. If it isn't, something else in that show's data is genuinely changing between runs (e.g. Sonarr importing/removing files), not this bug.
- **A genuinely upcoming season (e.g. only 1 episode announced so far) keeps getting unmonitored:** This should only happen if that season is already fully downloaded relative to what Sonarr currently knows about it (e.g. that 1 known episode has a file) — the app can't tell "this is all there'll ever be" from "more episodes are coming but Sonarr hasn't added them yet." If this happens, exclude the show via the Excluded Shows list until the rest of the season lands in Sonarr.
- **A scheduled unmonitor took a long time / next tick was late:** Expected on large Sonarr libraries; the worker is single-threaded and the Sonarr scan is one API call per series.
- **Scheduler ran but nothing downloaded:** The search command was accepted by Sonarr/Radarr — check indexer results in the Service Logs panel; arr-mgmt only triggers the search.

### A new season is monitored but never downloads

Check the series-level `monitored` flag as well as the season and episode flags.
All three levels must permit automatic downloads. Before the October 4, 2026 fix,
the wake-up logic only considered missing episodes with their own flag off, so it
missed new seasons whose episodes were already monitored under an unmonitored
series. The Gentlemen season 2 exposed this case.

The corrected manual/scheduled unmonitor task restores eligible series/season
flags even when every missing episode is already monitored. It logs that recovery
under `manual_new_season` or `scheduled_new_season`, leaves downloaded episode
flags off, and retains exclusions and the 2020 season-year floor. The regular
missing-episode search then picks up those episodes; a targeted Sonarr season
search can recover content immediately without waiting for the next search cycle.
