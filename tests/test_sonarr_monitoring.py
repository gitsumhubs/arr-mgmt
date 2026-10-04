"""Monitoring regressions using an in-memory Sonarr API and temporary history."""

from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import app as arr_mgmt


class SonarrMonitoringTests(unittest.TestCase):
    def setUp(self):
        self.config = {
            "sonarr_url": "http://sonarr.invalid",
            "sonarr_api_key": "test-key",
            "sonarr_unmonitor_excluded_series": [],
        }
        self.series = {
            "id": 86,
            "title": "The Gentlemen",
            "status": "continuing",
            "monitored": False,
            "monitorNewItems": "all",
            "seasons": [
                {"seasonNumber": 1, "monitored": False},
                {"seasonNumber": 2, "monitored": True},
            ],
        }
        self.episodes = [
            {
                "id": 100 + number,
                "seriesId": 86,
                "seasonNumber": 1,
                "episodeNumber": number,
                "title": f"Season 1 episode {number}",
                "airDate": "2024-03-07",
                "hasFile": True,
                "monitored": False,
            }
            for number in range(1, 9)
        ] + [
            {
                "id": 200 + number,
                "seriesId": 86,
                "seasonNumber": 2,
                "episodeNumber": number,
                "title": f"Season 2 episode {number}",
                "airDate": "2026-09-03",
                "hasFile": False,
                "monitored": True,
            }
            for number in range(1, 9)
        ]
        temp = TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        history = patch.object(arr_mgmt, "UNMONITOR_LOG_FILE", Path(temp.name) / "history.json")
        history.start()
        self.addCleanup(history.stop)
        api = patch.object(arr_mgmt, "api_request", side_effect=self.api_request)
        api.start()
        self.addCleanup(api.stop)

    def api_request(self, base_url, api_key, endpoint, method="GET", data=None):
        """Replace only the external API; retain state across actual app runs."""
        if method == "GET" and endpoint == "series":
            result = [self.series]
        elif method == "GET" and endpoint == "episode?seriesId=86":
            result = self.episodes
        elif method == "PUT" and endpoint == "series/86":
            self.series = deepcopy(data)
            result = self.series
        elif method == "PUT" and endpoint == "episode/monitor":
            for episode in self.episodes:
                if episode["id"] in data["episodeIds"]:
                    episode["monitored"] = data["monitored"]
            result = self.episodes
        else:
            self.fail(f"Unexpected Sonarr request: {method} {endpoint}")
        return {"success": True, "data": deepcopy(result)}

    def run_unmonitor(self):
        return arr_mgmt.perform_sonarr_unmonitor(self.config, source="scheduled")

    def test_missing_monitored_episodes_restore_disabled_parent_flags(self):
        for series_monitored, season_monitored in [(False, True), (True, False), (False, False)]:
            with self.subTest(series=series_monitored, season=season_monitored):
                self.series["monitored"] = series_monitored
                self.series["seasons"][1]["monitored"] = season_monitored

                result = self.run_unmonitor()

                self.assertTrue(self.series["monitored"])
                self.assertTrue(self.series["seasons"][1]["monitored"])
                self.assertFalse(self.series["seasons"][0]["monitored"])
                self.assertEqual(result["new_season_series_count"], 1)
                self.assertEqual(result["new_season_count"], 0)
                self.assertTrue(all(ep["monitored"] for ep in self.episodes[8:]))
                self.assertTrue(all(not ep["monitored"] for ep in self.episodes[:8]))
                self.assertEqual(arr_mgmt.load_unmonitor_log()[-1]["series"],
                                 [{"id": 86, "title": "The Gentlemen"}])

    def test_second_run_does_not_repeat_parent_recovery(self):
        self.run_unmonitor()
        history = arr_mgmt.load_unmonitor_log()
        result = self.run_unmonitor()
        self.assertTrue(self.series["monitored"])
        self.assertEqual(result["new_season_series_count"], 0)
        self.assertEqual(result["new_season_count"], 0)
        self.assertEqual(arr_mgmt.load_unmonitor_log(), history)

    def test_only_missing_episodes_are_reactivated_in_partial_season(self):
        self.series["seasons"][1]["monitored"] = False
        self.episodes[8]["hasFile"] = True
        for episode in self.episodes[8:]:
            episode["monitored"] = False
        result = self.run_unmonitor()
        self.assertTrue(self.series["monitored"])
        self.assertFalse(self.episodes[8]["monitored"])
        self.assertTrue(all(ep["monitored"] for ep in self.episodes[9:]))
        self.assertEqual(result["new_season_count"], 7)
        history = arr_mgmt.load_unmonitor_log()
        second = self.run_unmonitor()
        self.assertEqual(second["count"], 0)
        self.assertEqual(second["new_season_count"], 0)
        self.assertEqual(arr_mgmt.load_unmonitor_log(), history)

    def test_fully_downloaded_series_is_not_reactivated(self):
        self.series["monitored"] = True
        for episode in self.episodes[8:]:
            episode["hasFile"] = True
        self.run_unmonitor()
        self.assertFalse(self.series["monitored"])
        self.assertTrue(all(not ep["monitored"] for ep in self.episodes))
        self.run_unmonitor()
        self.assertFalse(self.series["monitored"])

    def test_excluded_series_is_left_alone(self):
        self.config["sonarr_unmonitor_excluded_series"] = [{"id": 86, "mode": "exclude"}]
        before = deepcopy(self.series)
        self.run_unmonitor()
        self.assertEqual(self.series, before)
        self.assertEqual(arr_mgmt.load_unmonitor_log(), [])

    def test_old_or_undated_missing_season_is_not_reactivated(self):
        for air_date in ["2019-09-03", None]:
            with self.subTest(air_date=air_date):
                for episode in self.episodes[8:]:
                    episode["airDate"] = air_date
                self.run_unmonitor()
                self.assertFalse(self.series["monitored"])
                self.assertEqual(arr_mgmt.load_unmonitor_log(), [])

    def test_latest_only_recovers_newest_season_without_waking_older_gaps(self):
        self.config["sonarr_unmonitor_excluded_series"] = [{"id": 86, "mode": "latest_only"}]
        self.series["seasons"][0]["monitored"] = True
        for episode in self.episodes[:8]:
            episode["hasFile"] = False
            episode["monitored"] = True
        self.run_unmonitor()
        self.assertTrue(self.series["monitored"])
        self.assertFalse(self.series["seasons"][0]["monitored"])
        self.assertTrue(all(not ep["monitored"] for ep in self.episodes[:8]))
        self.assertTrue(all(ep["monitored"] for ep in self.episodes[8:]))


if __name__ == "__main__":
    unittest.main()
