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
- App version badge beside the page title (currently `v1.1.0`)
- Manual and scheduled missing-content searches
- Downloaded-item unmonitoring with undo history
- Restores series and season monitoring for eligible missing seasons, including
  new seasons whose episodes Sonarr already monitors
- Per-show Sonarr exclusions
- Season Monitor Audit Exceptions under Unmonitor Downloaded: scan older missing seasons
  and save per-show exceptions to the 2020 cutoff. Exceptions apply on the next
  manual or scheduled Sonarr unmonitor run; existing show exclusions take priority.
- Specials section with its own saved show exceptions: unmonitor season 0 by
  default, monitor all specials on exception shows, and search only their missing
  specials. The regular unmonitor button and schedule preserve these exceptions.
- Docker restart and log controls

## Configuration

Runtime settings are stored in `config.json`. In Docker, `ARR_MGMT_DATA_DIR` is
set to `/data` by Compose. Do not commit API keys to public repositories.
The audit saves `{id, title}` selections in `sonarr_remonitor_ignore_year_series`
(empty by default). A selected show can re-monitor missing episodes in any season,
including undated ones. Saving a selection does not modify Sonarr immediately;
removing one restores the cutoff for future runs without undoing past changes.

Specials exceptions are stored as `{id, title}` entries in
`sonarr_specials_exceptions` (empty by default). Open **Specials Exceptions**, click
**Load Specials**, select shows, then click **Apply Specials Rules & Search**.
The button unmonitors missing and downloaded specials on other shows, and enables
the show, Specials season, and all special episodes for selected shows. Searches
target only missing specials. This action has its own exceptions, independent of
Excluded Shows and the 2020 cutoff; it preserves regular-season episode settings.
Checkbox changes only save settings. Removing an exception takes effect when the
Specials action is run again. No automatic specials schedule is configured.

The release version is defined by `APP_VERSION` in `app.py`. Bump it when
publishing a new release; the header and static asset cache keys use this value.

## Tests

Run the Sonarr monitoring regression suite without contacting live services:

```bash
./venv/bin/python -m unittest discover -s tests -v
```
