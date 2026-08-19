#!/usr/bin/env python3
"""
Arr Management Web UI
Flask backend for managing Sonarr and Radarr
"""

import json
import os
import subprocess
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import requests
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

CONFIG_FILE = Path(__file__).parent / "config.json"
UNMONITOR_LOG_FILE = Path(__file__).parent / "unmonitor_log.json"

DEFAULT_CONFIG = {
    "sonarr_url": "http://192.168.1.44:8989",
    "sonarr_api_key": "",
    "radarr_url": "http://192.168.1.44:7878",
    "radarr_api_key": "",
    "sonarr_container": "sonarr",
    "radarr_container": "radarr",
    "auto_search_sonarr_enabled": False,
    "auto_search_sonarr_interval_minutes": 360,
    "auto_search_sonarr_last_run": None,
    "auto_search_radarr_enabled": False,
    "auto_search_radarr_interval_minutes": 360,
    "auto_search_radarr_last_run": None,
    "auto_unmonitor_sonarr_enabled": False,
    "auto_unmonitor_sonarr_interval_minutes": 1440,
    "auto_unmonitor_sonarr_last_run": None,
    "auto_unmonitor_radarr_enabled": False,
    "auto_unmonitor_radarr_interval_minutes": 1440,
    "auto_unmonitor_radarr_last_run": None,
    "sonarr_unmonitor_excluded_series": [],
}

SCHEDULE_INTERVALS = [30, 60, 180, 360, 720, 1440, 2880, 10080]

# Only auto-monitor unmonitored, incomplete seasons that started airing on/after this
# year. A season that's already fully downloaded is never affected by this (that's
# handled by the "incomplete" check itself) - this floor only limits how far back an
# actually-missing season will get woken back up and searched for again.
SONARR_NEW_SEASON_MIN_YEAR = 2020

config_lock = threading.Lock()
log_lock = threading.Lock()


def load_config():
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE) as f:
            return {**DEFAULT_CONFIG, **json.load(f)}
    return DEFAULT_CONFIG.copy()


def save_config(config):
    with open(CONFIG_FILE, "w") as f:
        json.dump(config, f, indent=2)


def load_unmonitor_log():
    if UNMONITOR_LOG_FILE.exists():
        with open(UNMONITOR_LOG_FILE) as f:
            return json.load(f)
    return []


def save_unmonitor_log(entries):
    with open(UNMONITOR_LOG_FILE, "w") as f:
        json.dump(entries, f, indent=2)


def log_unmonitor_action(service, action, movies=None, episodes=None, series=None, source="manual"):
    """Log an unmonitor/remonitor action with full item details.

    movies: list of {"id": int, "title": str}
    episodes: list of {"id": int, "series": str, "season": int, "episode": int, "title": str}
    series: list of {"id": int, "title": str}
    source: "manual" (UI button) or "scheduled" (background worker)
    """
    status_change = "monitored -> unmonitored" if action == "unmonitor" else "unmonitored -> monitored"
    entry = {
        "id": str(uuid.uuid4())[:8],
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "service": service,
        "action": action,
        "status_change": status_change,
        "source": source,
    }
    if movies:
        entry["movies"] = movies
        entry["movie_ids"] = [m["id"] for m in movies]
    if episodes:
        entry["episodes"] = episodes
        entry["episode_ids"] = [e["id"] for e in episodes]
    if series:
        entry["series"] = series
        entry["series_ids"] = [s["id"] for s in series]
    # The scheduler writes from a background thread while the UI may be writing too
    with log_lock:
        entries = load_unmonitor_log()
        entries.append(entry)
        save_unmonitor_log(entries)
    return entry["id"]


def api_request(base_url, api_key, endpoint, method="GET", data=None):
    """Make request to Sonarr/Radarr API."""
    url = f"{base_url.rstrip('/')}/api/v3/{endpoint}"
    headers = {"X-Api-Key": api_key}

    try:
        if method == "GET":
            resp = requests.get(url, headers=headers, timeout=10)
        elif method == "PUT":
            headers["Content-Type"] = "application/json"
            resp = requests.put(url, headers=headers, json=data, timeout=30)
        else:
            headers["Content-Type"] = "application/json"
            resp = requests.post(url, headers=headers, json=data, timeout=10)

        resp.raise_for_status()
        return {"success": True, "data": resp.json()}
    except requests.exceptions.ConnectionError:
        return {"success": False, "error": "Connection failed"}
    except requests.exceptions.Timeout:
        return {"success": False, "error": "Request timed out"}
    except requests.exceptions.HTTPError as e:
        return {"success": False, "error": f"HTTP {e.response.status_code}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/status")
def get_status():
    """Get health status for both services."""
    config = load_config()

    sonarr = api_request(config["sonarr_url"], config["sonarr_api_key"], "health")
    radarr = api_request(config["radarr_url"], config["radarr_api_key"], "health")

    return jsonify({
        "sonarr": {
            "healthy": sonarr["success"],
            "warnings": len(sonarr.get("data", [])) if sonarr["success"] else 0,
            "error": sonarr.get("error")
        },
        "radarr": {
            "healthy": radarr["success"],
            "warnings": len(radarr.get("data", [])) if radarr["success"] else 0,
            "error": radarr.get("error")
        }
    })


@app.route("/api/queue")
def get_queue():
    """Get queue counts for both services."""
    config = load_config()

    sonarr = api_request(config["sonarr_url"], config["sonarr_api_key"], "queue?pageSize=1")
    radarr = api_request(config["radarr_url"], config["radarr_api_key"], "queue?pageSize=1")

    return jsonify({
        "sonarr": sonarr.get("data", {}).get("totalRecords", 0) if sonarr["success"] else "?",
        "radarr": radarr.get("data", {}).get("totalRecords", 0) if radarr["success"] else "?"
    })


def normalize_queue_items(data):
    if isinstance(data, dict):
        records = data.get("records", [])
    elif isinstance(data, list):
        records = data
    else:
        records = []

    items = []
    for record in records:
        title = (
            record.get("title")
            or record.get("movieTitle")
            or record.get("seriesTitle")
            or record.get("episodeTitle")
            or "Unknown"
        )
        quality = record.get("quality")
        if isinstance(quality, dict):
            quality = quality.get("quality", {}).get("name") or quality.get("name")
        status = record.get("status") or record.get("trackedDownloadStatus") or "unknown"
        time_left = record.get("timeleft") or record.get("timeLeft") or ""
        size = record.get("size")
        size_left = record.get("sizeleft") or record.get("sizeLeft")
        progress = None
        if isinstance(size, (int, float)) and isinstance(size_left, (int, float)) and size > 0:
            progress = round(((size - size_left) / size) * 100)

        items.append({
            "title": title,
            "status": status,
            "quality": quality or "",
            "time_left": time_left,
            "progress": progress,
            "download_client": record.get("downloadClient") or "",
        })
    return items


@app.route("/api/queue/items")
def get_queue_items():
    """Get recent queue items for both services."""
    config = load_config()
    try:
        limit = int(request.args.get("limit", 10))
    except ValueError:
        return jsonify({"success": False, "error": "Invalid limit"}), 400
    limit = max(1, min(limit, 50))

    sonarr = api_request(
        config["sonarr_url"],
        config["sonarr_api_key"],
        f"queue?pageSize={limit}"
    )
    radarr = api_request(
        config["radarr_url"],
        config["radarr_api_key"],
        f"queue?pageSize={limit}"
    )

    return jsonify({
        "success": True,
        "sonarr": normalize_queue_items(sonarr.get("data")) if sonarr["success"] else [],
        "radarr": normalize_queue_items(radarr.get("data")) if radarr["success"] else [],
        "sonarr_error": sonarr.get("error"),
        "radarr_error": radarr.get("error"),
    })


@app.route("/api/sonarr/search", methods=["POST"])
def sonarr_search():
    """Trigger missing episode search in Sonarr."""
    config = load_config()
    result = api_request(
        config["sonarr_url"],
        config["sonarr_api_key"],
        "command",
        method="POST",
        data={"name": "MissingEpisodeSearch"}
    )
    return jsonify(result)


@app.route("/api/radarr/search", methods=["POST"])
def radarr_search():
    """Trigger missing movie search in Radarr."""
    config = load_config()
    result = api_request(
        config["radarr_url"],
        config["radarr_api_key"],
        "command",
        method="POST",
        data={"name": "MissingMoviesSearch"}
    )
    return jsonify(result)


@app.route("/api/sonarr/restart", methods=["POST"])
def sonarr_restart():
    """Restart Sonarr Docker container."""
    config = load_config()
    try:
        subprocess.run(
            ["docker", "restart", config["sonarr_container"]],
            check=True,
            capture_output=True,
            timeout=60
        )
        return jsonify({"success": True})
    except subprocess.CalledProcessError as e:
        return jsonify({"success": False, "error": e.stderr.decode()})
    except subprocess.TimeoutExpired:
        return jsonify({"success": False, "error": "Restart timed out"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@app.route("/api/radarr/restart", methods=["POST"])
def radarr_restart():
    """Restart Radarr Docker container."""
    config = load_config()
    try:
        subprocess.run(
            ["docker", "restart", config["radarr_container"]],
            check=True,
            capture_output=True,
            timeout=60
        )
        return jsonify({"success": True})
    except subprocess.CalledProcessError as e:
        return jsonify({"success": False, "error": e.stderr.decode()})
    except subprocess.TimeoutExpired:
        return jsonify({"success": False, "error": "Restart timed out"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})


@app.route("/api/logs/<service>")
def get_logs(service):
    """Fetch recent logs from a Docker container."""
    config = load_config()
    containers = {
        "sonarr": config["sonarr_container"],
        "radarr": config["radarr_container"],
    }
    if service not in containers:
        return jsonify({"success": False, "error": "Unknown service"}), 400

    try:
        lines = int(request.args.get("lines", 200))
    except ValueError:
        return jsonify({"success": False, "error": "Invalid lines value"}), 400

    lines = max(10, min(lines, 1000))
    container = containers[service]

    try:
        result = subprocess.run(
            ["docker", "logs", "--tail", str(lines), container],
            check=True,
            capture_output=True,
            timeout=10,
            text=True,
        )
        return jsonify({"success": True, "logs": result.stdout})
    except subprocess.CalledProcessError as e:
        detail = (e.stderr or e.stdout or "").strip()
        return jsonify({"success": False, "error": detail or "Failed to read logs"}), 500
    except subprocess.TimeoutExpired:
        return jsonify({"success": False, "error": "Log request timed out"}), 500
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


def perform_radarr_unmonitor(config, source="manual"):
    """Unmonitor all downloaded movies in Radarr. Returns a JSON-ready dict."""
    base_url = config["radarr_url"]
    api_key = config["radarr_api_key"]

    result = api_request(base_url, api_key, "movie")
    if not result["success"]:
        return {"success": False, "error": result.get("error", "Failed to fetch movies")}

    affected_movies = [
        {"id": m["id"], "title": m.get("title", "Unknown")}
        for m in result["data"]
        if m.get("monitored") and m.get("hasFile")
    ]

    if not affected_movies:
        return {"success": True, "count": 0, "message": "No downloaded monitored movies found"}

    movie_ids = [m["id"] for m in affected_movies]
    edit_result = api_request(
        base_url, api_key, "movie/editor",
        method="PUT",
        data={"movieIds": movie_ids, "monitored": False}
    )

    if edit_result["success"]:
        log_unmonitor_action("radarr", "unmonitor", movies=affected_movies, source=source)
        return {"success": True, "count": len(movie_ids), "ids": movie_ids}
    return {"success": False, "error": edit_result.get("error", "Failed to update movies")}


@app.route("/api/radarr/unmonitor-downloaded", methods=["POST"])
def radarr_unmonitor_downloaded():
    """Unmonitor all downloaded movies in Radarr."""
    return jsonify(perform_radarr_unmonitor(load_config()))


def perform_sonarr_unmonitor(config, source="manual"):
    """Unmonitor downloaded episodes, and:
    - fully unmonitor a series once every known non-special episode is downloaded,
      regardless of Sonarr's series status - "continuing" alone doesn't protect a
      series; only an actually-incomplete season does (see below), so this is safe
      for still-airing shows too
    - if some (but not all) seasons are complete, retire just those individually
      (season-level monitor flag off) and leave the incomplete one alone
    - re-monitor any unmonitored, incomplete season (excluding specials) that started
      airing in SONARR_NEW_SEASON_MIN_YEAR or later, and re-monitor the series itself
      to match - "incomplete" is what stops this from re-monitoring a season we
      already correctly finished just because it happens to have aired recently, and
      is also what keeps a genuinely new season (one Sonarr has data for but hasn't
      downloaded yet) monitored, including one that shows up long after the series
      was fully unmonitored
    - series listed in config["sonarr_unmonitor_excluded_series"] are skipped
      entirely (mode "exclude", the default) or restricted to only their newest
      season (mode "latest_only") - every older season is force-unmonitored
      regardless of completeness, and the newest season follows the normal rules
      above as if it were the show's only season
    Returns a JSON-ready dict."""
    base_url = config["sonarr_url"]
    api_key = config["sonarr_api_key"]

    series_result = api_request(base_url, api_key, "series")
    if not series_result["success"]:
        return {"success": False, "error": series_result.get("error", "Failed to fetch series")}

    series_modes = {
        e["id"]: e.get("mode", "exclude") for e in config.get("sonarr_unmonitor_excluded_series", [])
    }

    affected_episodes = []
    affected_series = []
    affected_seasons = []
    episode_ids = []
    new_season_episodes = []
    new_season_series = []
    new_season_episode_ids = []
    for s in series_result["data"]:
        mode = series_modes.get(s["id"])
        if mode == "exclude":
            continue

        series_title = s.get("title", "Unknown")
        ep_result = api_request(base_url, api_key, f"episode?seriesId={s['id']}")
        if not ep_result["success"]:
            continue

        episodes = ep_result["data"]
        for ep in episodes:
            if ep.get("monitored") and ep.get("hasFile"):
                episode_ids.append(ep["id"])
                affected_episodes.append({
                    "id": ep["id"],
                    "series": series_title,
                    "season": ep.get("seasonNumber", 0),
                    "episode": ep.get("episodeNumber", 0),
                    "title": ep.get("title", ""),
                })

        # Specials (season 0) never count toward "fully downloaded" or "new season" checks
        regular_episodes = [ep for ep in episodes if ep.get("seasonNumber", 0) != 0]
        if not regular_episodes:
            continue

        seasons_by_number = {}
        for ep in regular_episodes:
            seasons_by_number.setdefault(ep.get("seasonNumber"), []).append(ep)

        if mode == "latest_only":
            latest_season_num = max(seasons_by_number)
            series_changed = False
            force_unmonitor_ids = []
            for season_num, season_eps in seasons_by_number.items():
                if season_num == latest_season_num:
                    continue
                for ep in season_eps:
                    # Episodes that are monitored+hasFile are already queued for
                    # unmonitor by the per-episode loop above; only need to force the
                    # ones that are monitored but still missing (i.e. still "wanted").
                    if ep.get("monitored") and not ep.get("hasFile"):
                        force_unmonitor_ids.append(ep["id"])
                for season_entry in s.get("seasons", []):
                    if season_entry.get("seasonNumber") == season_num and season_entry.get("monitored"):
                        season_entry["monitored"] = False
                        series_changed = True
            if force_unmonitor_ids:
                api_request(
                    base_url, api_key, "episode/monitor",
                    method="PUT", data={"episodeIds": force_unmonitor_ids, "monitored": False}
                )
            if series_changed:
                api_request(base_url, api_key, f"series/{s['id']}", method="PUT", data=s)
            # Only the newest season follows the normal rules below, as if it were
            # the show's only season.
            seasons_by_number = {latest_season_num: seasons_by_number[latest_season_num]}
            regular_episodes = seasons_by_number[latest_season_num]

        # Wake up (re-monitor) any season that started airing on/after
        # SONARR_NEW_SEASON_MIN_YEAR and has an unmonitored episode that's actually
        # missing a file - catches a season Sonarr imported after the series was
        # previously (fully) unmonitored. Only the missing episode(s) themselves get
        # reactivated, never their already-downloaded siblings in the same season -
        # reactivating every unmonitored episode just because the season also
        # contains one missing episode would flip-flop those downloaded episodes
        # between monitored/unmonitored every run (the per-episode loop above
        # unmonitors them again the moment they're reactivated, since they're
        # monitored+hasFile again).
        reactivated = False
        for season_num, season_eps in seasons_by_number.items():
            missing_unmonitored_eps = [
                ep for ep in season_eps if not ep.get("monitored") and not ep.get("hasFile")
            ]
            if not missing_unmonitored_eps:
                continue
            air_years = [int(ep["airDate"][:4]) for ep in season_eps if ep.get("airDate")]
            recently_started = bool(air_years) and min(air_years) >= SONARR_NEW_SEASON_MIN_YEAR
            if not recently_started:
                continue
            reactivated = True
            new_season_episode_ids.extend(ep["id"] for ep in missing_unmonitored_eps)
            new_season_episodes.extend({
                "id": ep["id"],
                "series": series_title,
                "season": season_num,
                "episode": ep.get("episodeNumber", 0),
                "title": ep.get("title", ""),
            } for ep in missing_unmonitored_eps)
            for season_entry in s.get("seasons", []):
                if season_entry.get("seasonNumber") == season_num:
                    season_entry["monitored"] = True

        if reactivated:
            s["monitored"] = True
            api_request(base_url, api_key, f"series/{s['id']}", method="PUT", data=s)
            new_season_series.append({"id": s["id"], "title": series_title})
        elif all(ep.get("hasFile") for ep in regular_episodes):
            # Every known non-special episode is downloaded - unmonitor the whole
            # series regardless of status. Safe even for a still-airing show: the
            # reactivation check above already catches (and takes priority over) any
            # show with a genuinely incomplete season, and it'll flip this back on
            # the moment Sonarr adds a real new one, whenever that happens.
            if s.get("monitored"):
                s["monitored"] = False
                api_request(base_url, api_key, f"series/{s['id']}", method="PUT", data=s)
                affected_series.append({"id": s["id"], "title": series_title})
        else:
            # Some season is incomplete (and wasn't caught by the reactivation check
            # above, e.g. no air date yet) - retire whichever seasons ARE fully
            # downloaded and leave the incomplete one alone.
            series_changed = False
            for season_num, season_eps in seasons_by_number.items():
                if not all(ep.get("hasFile") for ep in season_eps):
                    continue
                for season_entry in s.get("seasons", []):
                    if season_entry.get("seasonNumber") == season_num and season_entry.get("monitored"):
                        season_entry["monitored"] = False
                        series_changed = True
                        affected_seasons.append({"id": s["id"], "title": series_title, "season": season_num})
            if series_changed:
                api_request(base_url, api_key, f"series/{s['id']}", method="PUT", data=s)

    ep_count = 0
    if episode_ids:
        monitor_result = api_request(
            base_url, api_key, "episode/monitor",
            method="PUT",
            data={"episodeIds": episode_ids, "monitored": False}
        )
        if monitor_result["success"]:
            ep_count = len(episode_ids)

    new_season_count = 0
    if new_season_episode_ids:
        monitor_result = api_request(
            base_url, api_key, "episode/monitor",
            method="PUT",
            data={"episodeIds": new_season_episode_ids, "monitored": True}
        )
        if monitor_result["success"]:
            new_season_count = len(new_season_episode_ids)

    if ep_count or affected_series:
        log_unmonitor_action("sonarr", "unmonitor", episodes=affected_episodes,
                             series=affected_series, source=source)

    if affected_seasons:
        # Each item carries a "season" key so undo can restore that season specifically
        # instead of re-monitoring the whole (still-airing) series.
        log_unmonitor_action("sonarr", "unmonitor", series=affected_seasons,
                             source=f"{source}_season")

    if new_season_count or new_season_series:
        log_unmonitor_action("sonarr", "remonitor", episodes=new_season_episodes,
                             series=new_season_series, source=f"{source}_new_season")

    nothing_happened = (
        ep_count == 0 and not affected_series and not affected_seasons
        and new_season_count == 0 and not new_season_series
    )
    if nothing_happened:
        return {"success": True, "count": 0, "series_count": 0, "season_count": 0,
                "new_season_count": 0, "new_season_series_count": 0,
                "message": "No downloaded monitored episodes, completed series/seasons, or new seasons found"}

    return {
        "success": True,
        "count": ep_count, "series_count": len(affected_series),
        "episode_ids": episode_ids, "series_ids": [s["id"] for s in affected_series],
        "season_count": len(affected_seasons),
        "new_season_count": new_season_count, "new_season_series_count": len(new_season_series),
        "new_season_episode_ids": new_season_episode_ids,
        "new_season_series_ids": [ns["id"] for ns in new_season_series],
    }


@app.route("/api/sonarr/unmonitor-downloaded", methods=["POST"])
def sonarr_unmonitor_downloaded():
    """Unmonitor all downloaded episodes and fully-downloaded series in Sonarr."""
    return jsonify(perform_sonarr_unmonitor(load_config()))


@app.route("/api/sonarr/series-list")
def sonarr_series_list():
    """List every Sonarr series (id/title/year/status) for the exclusion search box."""
    config = load_config()
    result = api_request(config["sonarr_url"], config["sonarr_api_key"], "series")
    if not result["success"]:
        return jsonify({"success": False, "error": result.get("error", "Failed to fetch series")})
    series = sorted(
        (
            {"id": s["id"], "title": s.get("title", "Unknown"), "year": s.get("year"), "status": s.get("status")}
            for s in result["data"]
        ),
        key=lambda s: s["title"].lower(),
    )
    return jsonify({"success": True, "series": series})


@app.route("/api/sonarr/exclusions")
def sonarr_exclusions():
    """List excluded series, plus any exclusion whose series is no longer in Sonarr
    (removed/re-added), with a same-title candidate in the current library if found."""
    config = load_config()
    exclusions = config.get("sonarr_unmonitor_excluded_series", [])

    stale = []
    result = api_request(config["sonarr_url"], config["sonarr_api_key"], "series")
    if result["success"]:
        excluded_ids = {e["id"] for e in exclusions}
        current_ids = {s["id"] for s in result["data"]}
        by_title = {
            s.get("title", "").strip().lower(): s
            for s in result["data"] if s["id"] not in excluded_ids
        }
        for e in exclusions:
            if e["id"] in current_ids:
                continue
            candidate = by_title.get((e.get("title") or "").strip().lower())
            stale.append({
                "id": e["id"],
                "title": e.get("title", "Unknown"),
                "candidate_id": candidate["id"] if candidate else None,
                "candidate_title": candidate.get("title") if candidate else None,
            })

    return jsonify({"success": True, "exclusions": exclusions, "stale": stale})


VALID_EXCLUSION_MODES = ("exclude", "latest_only")


@app.route("/api/sonarr/exclusions", methods=["POST"])
def update_sonarr_exclusions():
    """Add, remove, swap (removed/re-added), or change the mode of a Sonarr series
    exclusion. Modes: "exclude" (default, skip entirely) or "latest_only" (force-
    unmonitor every season except the newest, which follows the normal rules)."""
    data = request.get_json(silent=True)
    if not data or "action" not in data:
        return jsonify({"success": False, "error": "Invalid payload"}), 400

    action = data["action"]
    mode = data.get("mode", "exclude")
    if mode not in VALID_EXCLUSION_MODES:
        return jsonify({"success": False, "error": f"Invalid mode, must be one of {VALID_EXCLUSION_MODES}"}), 400

    with config_lock:
        config = load_config()
        exclusions = config.get("sonarr_unmonitor_excluded_series", [])

        if action == "add":
            if "id" not in data or "title" not in data:
                return jsonify({"success": False, "error": "id and title required"}), 400
            if not any(e["id"] == data["id"] for e in exclusions):
                exclusions.append({"id": data["id"], "title": data["title"], "mode": mode})
        elif action == "remove":
            if "id" not in data:
                return jsonify({"success": False, "error": "id required"}), 400
            exclusions = [e for e in exclusions if e["id"] != data["id"]]
        elif action == "swap":
            if "old_id" not in data or "new_id" not in data or "new_title" not in data:
                return jsonify({"success": False, "error": "old_id, new_id, new_title required"}), 400
            old_mode = next((e.get("mode", "exclude") for e in exclusions if e["id"] == data["old_id"]), "exclude")
            exclusions = [e for e in exclusions if e["id"] != data["old_id"]]
            if not any(e["id"] == data["new_id"] for e in exclusions):
                exclusions.append({"id": data["new_id"], "title": data["new_title"], "mode": old_mode})
        elif action == "set_mode":
            if "id" not in data:
                return jsonify({"success": False, "error": "id required"}), 400
            for e in exclusions:
                if e["id"] == data["id"]:
                    e["mode"] = mode
        else:
            return jsonify({"success": False, "error": "Unknown action"}), 400

        config["sonarr_unmonitor_excluded_series"] = exclusions
        save_config(config)

    return jsonify({"success": True, "exclusions": exclusions})


@app.route("/api/radarr/remonitor", methods=["POST"])
def radarr_remonitor():
    """Re-monitor previously unmonitored movies (undo)."""
    config = load_config()
    data = request.get_json(silent=True)
    if not data or not data.get("ids"):
        return jsonify({"success": False, "error": "No movie IDs provided"}), 400

    # Fetch movie titles for logging
    all_movies = api_request(config["radarr_url"], config["radarr_api_key"], "movie")
    movie_map = {}
    if all_movies["success"]:
        movie_map = {m["id"]: m.get("title", "Unknown") for m in all_movies["data"]}

    result = api_request(
        config["radarr_url"], config["radarr_api_key"], "movie/editor",
        method="PUT",
        data={"movieIds": data["ids"], "monitored": True}
    )

    if result["success"]:
        movies = [{"id": mid, "title": movie_map.get(mid, "Unknown")} for mid in data["ids"]]
        log_unmonitor_action("radarr", "remonitor", movies=movies)
        return jsonify({"success": True, "count": len(data["ids"])})
    return jsonify({"success": False, "error": result.get("error", "Failed to re-monitor movies")})


@app.route("/api/sonarr/remonitor", methods=["POST"])
def sonarr_remonitor():
    """Re-monitor previously unmonitored episodes and series (undo)."""
    config = load_config()
    base_url = config["sonarr_url"]
    api_key = config["sonarr_api_key"]
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"success": False, "error": "No data provided"}), 400

    ep_count = 0
    episode_ids = data.get("episode_ids", [])
    remonitored_episodes = []
    if episode_ids:
        ep_result = api_request(
            base_url, api_key, "episode/monitor",
            method="PUT",
            data={"episodeIds": episode_ids, "monitored": True}
        )
        if ep_result["success"]:
            ep_count = len(episode_ids)
            # Collect episode details from returned data for logging
            if isinstance(ep_result["data"], list):
                for ep in ep_result["data"]:
                    series_title = ep.get("series", {}).get("title", "Unknown") if isinstance(ep.get("series"), dict) else "Unknown"
                    remonitored_episodes.append({
                        "id": ep["id"],
                        "series": series_title,
                        "season": ep.get("seasonNumber", 0),
                        "episode": ep.get("episodeNumber", 0),
                        "title": ep.get("title", ""),
                    })

    remonitored_series = []
    for sid in data.get("series_ids", []):
        s_result = api_request(base_url, api_key, f"series/{sid}")
        if not s_result["success"]:
            continue
        series_data = s_result["data"]
        series_data["monitored"] = True
        update = api_request(base_url, api_key, f"series/{sid}", method="PUT", data=series_data)
        if update["success"]:
            remonitored_series.append({"id": sid, "title": series_data.get("title", "Unknown")})

    log_unmonitor_action("sonarr", "remonitor",
                         episodes=remonitored_episodes or [{"id": eid} for eid in episode_ids],
                         series=remonitored_series)
    return jsonify({"success": True, "count": ep_count, "series_count": len(remonitored_series)})


@app.route("/api/unmonitor-log")
def get_unmonitor_log():
    """Get the unmonitor action log, optionally filtered by service."""
    service = request.args.get("service")
    entries = load_unmonitor_log()
    if service:
        entries = [e for e in entries if e["service"] == service]
    entries.reverse()
    return jsonify({"success": True, "entries": entries})


@app.route("/api/unmonitor-log/undo/<entry_id>", methods=["POST"])
def undo_log_entry(entry_id):
    """Undo a specific log entry by re-monitoring its items."""
    entries = load_unmonitor_log()
    entry = None
    for e in entries:
        if e["id"] == entry_id:
            entry = e
            break
    if not entry:
        return jsonify({"success": False, "error": "Log entry not found"}), 404
    if entry["action"] != "unmonitor":
        return jsonify({"success": False, "error": "Can only undo unmonitor actions"}), 400

    config = load_config()
    service = entry["service"]

    if service == "radarr":
        movie_ids = entry.get("movie_ids", [])
        if not movie_ids:
            return jsonify({"success": False, "error": "No movie IDs in log entry"})
        # Use stored titles from the original log entry
        movies_detail = entry.get("movies", [{"id": mid, "title": "Unknown"} for mid in movie_ids])
        result = api_request(
            config["radarr_url"], config["radarr_api_key"], "movie/editor",
            method="PUT", data={"movieIds": movie_ids, "monitored": True}
        )
        if result["success"]:
            log_unmonitor_action("radarr", "remonitor", movies=movies_detail)
            return jsonify({"success": True, "count": len(movie_ids), "series_count": 0})
        return jsonify({"success": False, "error": result.get("error")})

    elif service == "sonarr":
        base_url = config["sonarr_url"]
        api_key = config["sonarr_api_key"]
        episode_ids = entry.get("episode_ids", [])
        series_ids = entry.get("series_ids", [])
        episodes_detail = entry.get("episodes", [{"id": eid} for eid in episode_ids])
        series_detail = entry.get("series", [{"id": sid, "title": "Unknown"} for sid in series_ids])

        ep_count = 0
        if episode_ids:
            ep_result = api_request(
                base_url, api_key, "episode/monitor",
                method="PUT", data={"episodeIds": episode_ids, "monitored": True}
            )
            if ep_result["success"]:
                ep_count = len(episode_ids)

        # Entries logged as season-only completions carry a "season" key per item so
        # undo restores that specific season instead of the whole (still-airing) series.
        season_map = {}
        for sd in series_detail:
            if sd.get("season") is not None:
                season_map.setdefault(sd["id"], []).append(sd["season"])

        remonitored_series = []
        for sid in series_ids:
            s_result = api_request(base_url, api_key, f"series/{sid}")
            if not s_result["success"]:
                continue
            series_data = s_result["data"]
            series_data["monitored"] = True
            for season_num in season_map.get(sid, []):
                for season_entry in series_data.get("seasons", []):
                    if season_entry.get("seasonNumber") == season_num:
                        season_entry["monitored"] = True
            update = api_request(base_url, api_key, f"series/{sid}", method="PUT", data=series_data)
            if update["success"]:
                remonitored_series.append({"id": sid, "title": series_data.get("title", "Unknown")})

        log_unmonitor_action("sonarr", "remonitor", episodes=episodes_detail,
                             series=remonitored_series or series_detail)
        return jsonify({"success": True, "count": ep_count, "series_count": len(remonitored_series)})

    return jsonify({"success": False, "error": "Unknown service"}), 400


def trigger_search(service, config):
    command = "MissingEpisodeSearch" if service == "sonarr" else "MissingMoviesSearch"
    return api_request(
        config[f"{service}_url"],
        config[f"{service}_api_key"],
        "command",
        method="POST",
        data={"name": command},
    )


def run_unmonitor(service, config):
    if service == "sonarr":
        return perform_sonarr_unmonitor(config, source="scheduled")
    return perform_radarr_unmonitor(config, source="scheduled")


# prefix -> callable(service, config) -> {"success": bool, ...}
SCHEDULED_TASKS = {
    "auto_search": trigger_search,
    "auto_unmonitor": run_unmonitor,
}


def check_and_run_scheduled(prefix, runner):
    """Run `runner` for each service whose schedule is due, then persist last_run."""
    with config_lock:
        config = load_config()
    now = datetime.now(timezone.utc)
    completed = {}
    for service in ("sonarr", "radarr"):
        if not config.get(f"{prefix}_{service}_enabled"):
            continue
        interval = int(config.get(f"{prefix}_{service}_interval_minutes") or 360)
        last_run = config.get(f"{prefix}_{service}_last_run")
        if last_run:
            try:
                last = datetime.fromisoformat(last_run)
            except ValueError:
                last = None
        else:
            last = None
        if last and (now - last).total_seconds() < interval * 60:
            continue
        result = runner(service, config)
        # Only record a run on success, so an unreachable service retries next tick
        if result.get("success"):
            completed[f"{prefix}_{service}_last_run"] = now.isoformat()
    if completed:
        with config_lock:
            current = load_config()
            current.update(completed)
            save_config(current)


def scheduler_worker():
    while True:
        for prefix, runner in SCHEDULED_TASKS.items():
            try:
                check_and_run_scheduled(prefix, runner)
            except Exception:
                pass
        time.sleep(60)


def schedule_state(prefix, default_interval):
    config = load_config()
    state = {"intervals": SCHEDULE_INTERVALS}
    for service in ("sonarr", "radarr"):
        state[service] = {
            "enabled": bool(config.get(f"{prefix}_{service}_enabled")),
            "interval_minutes": int(
                config.get(f"{prefix}_{service}_interval_minutes") or default_interval
            ),
            "last_run": config.get(f"{prefix}_{service}_last_run"),
        }
    return state


def update_schedule(prefix, data):
    """Apply a schedule update payload. Returns (response, status_code)."""
    if data is None:
        return {"success": False, "error": "Invalid JSON payload"}, 400

    with config_lock:
        config = load_config()
        for service in ("sonarr", "radarr"):
            section = data.get(service) or {}
            if "enabled" in section:
                config[f"{prefix}_{service}_enabled"] = bool(section["enabled"])
            if "interval_minutes" in section:
                try:
                    minutes = int(section["interval_minutes"])
                except (TypeError, ValueError):
                    return {"success": False, "error": f"Invalid interval for {service}"}, 400
                if minutes not in SCHEDULE_INTERVALS:
                    return {"success": False, "error": f"Unsupported interval for {service}"}, 400
                config[f"{prefix}_{service}_interval_minutes"] = minutes
        try:
            save_config(config)
        except Exception as e:
            return {"success": False, "error": str(e)}, 500

    return {"success": True}, 200


@app.route("/api/auto-search", methods=["GET"])
def get_auto_search():
    return jsonify(schedule_state("auto_search", 360))


@app.route("/api/auto-search", methods=["POST"])
def update_auto_search():
    body, status = update_schedule("auto_search", request.get_json(silent=True))
    return jsonify(body), status


@app.route("/api/auto-unmonitor", methods=["GET"])
def get_auto_unmonitor():
    return jsonify(schedule_state("auto_unmonitor", 1440))


@app.route("/api/auto-unmonitor", methods=["POST"])
def update_auto_unmonitor():
    body, status = update_schedule("auto_unmonitor", request.get_json(silent=True))
    return jsonify(body), status


@app.route("/api/config", methods=["GET"])
def get_config():
    """Get current config with masked API keys."""
    config = load_config()
    return jsonify({
        "sonarr_url": config["sonarr_url"],
        "sonarr_api_key": "***" + config["sonarr_api_key"][-4:] if config["sonarr_api_key"] else "",
        "radarr_url": config["radarr_url"],
        "radarr_api_key": "***" + config["radarr_api_key"][-4:] if config["radarr_api_key"] else "",
        "sonarr_container": config["sonarr_container"],
        "radarr_container": config["radarr_container"],
    })


@app.route("/api/config", methods=["POST"])
def update_config():
    """Update configuration."""
    config = load_config()
    data = request.get_json(silent=True)
    if data is None:
        return jsonify({"success": False, "error": "Invalid JSON payload"}), 400

    if "sonarr_url" in data:
        config["sonarr_url"] = data["sonarr_url"]
    if "sonarr_api_key" in data and not data["sonarr_api_key"].startswith("***"):
        config["sonarr_api_key"] = data["sonarr_api_key"]
    if "radarr_url" in data:
        config["radarr_url"] = data["radarr_url"]
    if "radarr_api_key" in data and not data["radarr_api_key"].startswith("***"):
        config["radarr_api_key"] = data["radarr_api_key"]
    if "sonarr_container" in data:
        config["sonarr_container"] = data["sonarr_container"]
    if "radarr_container" in data:
        config["radarr_container"] = data["radarr_container"]

    try:
        save_config(config)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
    return jsonify({"success": True})


if __name__ == "__main__":
    threading.Thread(target=scheduler_worker, daemon=True).start()
    app.run(host="0.0.0.0", port=7664, debug=False)
