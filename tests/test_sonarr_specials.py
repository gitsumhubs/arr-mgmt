"""Specials actions exercise real handlers against a stateful Sonarr boundary."""

from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory
import threading
import unittest
from unittest.mock import patch

import app as arr_mgmt


class SonarrSpecialsTests(unittest.TestCase):
    def setUp(self):
        self.config = {
            "sonarr_url": "http://sonarr.invalid", "sonarr_api_key": "test-key",
            "sonarr_specials_exceptions": [], "sonarr_unmonitor_excluded_series": [],
        }
        self.series = {
            1: {"id": 1, "title": "Exception Show", "monitored": False,
                "seasons": [{"seasonNumber": 0, "monitored": False}, {"seasonNumber": 1, "monitored": True}]},
            2: {"id": 2, "title": "Default Show", "monitored": True,
                "seasons": [{"seasonNumber": 0, "monitored": True}, {"seasonNumber": 1, "monitored": True}]},
        }
        self.episodes = {
            1: [self.episode(101, 1, 0, False, False), self.episode(102, 1, 0, True, False),
                self.episode(110, 1, 1, True, True)],
            2: [self.episode(201, 2, 0, False, True), self.episode(202, 2, 0, True, True),
                self.episode(210, 2, 1, False, True)],
        }
        self.commands = []
        self.failures = set()
        temp = TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        for name, filename in [("CONFIG_FILE", "config.json"), ("UNMONITOR_LOG_FILE", "history.json")]:
            replacement = patch.object(arr_mgmt, name, Path(temp.name) / filename)
            replacement.start()
            self.addCleanup(replacement.stop)
        api = patch.object(arr_mgmt, "api_request", side_effect=self.api_request)
        api.start()
        self.addCleanup(api.stop)
        arr_mgmt.save_config(self.config)
        self.client = arr_mgmt.app.test_client()

    @staticmethod
    def episode(id_, series, season, downloaded, monitored):
        return {"id": id_, "seriesId": series, "seasonNumber": season, "episodeNumber": id_,
                "title": f"Episode {id_}", "hasFile": downloaded, "monitored": monitored,
                "airDate": "2015-01-01"}

    def api_request(self, base_url, api_key, endpoint, method="GET", data=None):
        if (method, endpoint) in self.failures:
            return {"success": False, "error": "Test Sonarr failure"}
        if method == "GET" and endpoint == "series":
            result = list(self.series.values())
        elif method == "GET" and endpoint.startswith("episode?seriesId="):
            result = self.episodes[int(endpoint.split("=")[1])]
        elif method == "PUT" and endpoint.startswith("series/"):
            id_ = int(endpoint.split("/")[1])
            self.series[id_] = deepcopy(data)
            result = self.series[id_]
        elif method == "PUT" and endpoint == "episode/monitor":
            for episodes in self.episodes.values():
                for ep in episodes:
                    if ep["id"] in data["episodeIds"]:
                        ep["monitored"] = data["monitored"]
            result = []
        elif method == "POST" and endpoint == "command":
            self.commands.append(deepcopy(data))
            result = {"id": len(self.commands)}
        else:
            self.fail(f"Unexpected Sonarr operation: {method} {endpoint}")
        return {"success": True, "data": deepcopy(result)}

    def select_exception(self):
        self.config["sonarr_specials_exceptions"] = [{"id": 1, "title": "Exception Show"}]
        arr_mgmt.save_config(self.config)

    def apply(self):
        response = self.client.post("/api/sonarr/specials/apply")
        self.assertEqual(response.status_code, 200)
        return response.get_json()

    def test_default_unmonitors_missing_and_downloaded_specials_without_touching_regulars(self):
        before = [deepcopy(self.episodes[1][2]), deepcopy(self.episodes[2][2])]
        result = self.apply()
        self.assertTrue(result["success"])
        self.assertEqual(result["unmonitored_count"], 2)
        self.assertTrue(all(not ep["monitored"] for eps in self.episodes.values() for ep in eps if ep["seasonNumber"] == 0))
        self.assertFalse(self.series[2]["seasons"][0]["monitored"])
        self.assertTrue(self.series[2]["monitored"])
        self.assertEqual([self.episodes[1][2], self.episodes[2][2]], before)
        self.assertEqual(self.commands, [])
        self.assertEqual(arr_mgmt.load_unmonitor_log()[0]["episode_ids"], [201, 202])

    def test_exception_enables_series_season_and_all_specials_searches_only_missing(self):
        self.select_exception()
        result = self.apply()
        self.assertTrue(result["success"])
        self.assertEqual(result["monitored_count"], 2)
        self.assertTrue(self.series[1]["monitored"])
        self.assertTrue(self.series[1]["seasons"][0]["monitored"])
        self.assertTrue(all(ep["monitored"] for ep in self.episodes[1][:2]))
        self.assertTrue(all(not ep["monitored"] for ep in self.episodes[2][:2]))
        self.assertEqual(self.commands, [{"name": "EpisodeSearch", "episodeIds": [101]}])
        self.assertEqual(result["search_count"], 1)
        second = self.apply()
        self.assertEqual(second["unmonitored_count"], 0)
        self.assertEqual(second["monitored_count"], 0)
        # Clicking the action again intentionally retries the missing-special search.
        self.assertEqual(second["search_count"], 1)

    def test_specials_action_uses_its_own_exceptions_independent_of_regular_exclusions(self):
        self.select_exception()
        self.config["sonarr_unmonitor_excluded_series"] = [
            {"id": 1, "mode": "exclude"}, {"id": 2, "mode": "latest_only"},
        ]
        arr_mgmt.save_config(self.config)
        self.apply()
        self.assertTrue(self.episodes[1][0]["monitored"])
        self.assertFalse(self.episodes[2][0]["monitored"])

    def test_regular_unmonitor_preserves_specials_exceptions_and_parent_monitoring(self):
        self.select_exception()
        self.apply()
        result = arr_mgmt.perform_sonarr_unmonitor(arr_mgmt.load_config())
        self.assertTrue(result["success"])
        self.assertTrue(self.series[1]["monitored"])
        self.assertTrue(self.series[1]["seasons"][0]["monitored"])
        self.assertTrue(all(ep["monitored"] for ep in self.episodes[1][:2]))
        self.assertFalse(self.episodes[1][2]["monitored"])
        self.assertFalse(self.series[1]["seasons"][1]["monitored"])

    def test_empty_specials_exception_keeps_parent_ready_for_future_specials(self):
        self.select_exception()
        self.episodes[1] = [self.episodes[1][2]]
        self.apply()
        arr_mgmt.perform_sonarr_unmonitor(arr_mgmt.load_config())
        self.assertTrue(self.series[1]["monitored"])
        self.assertTrue(self.series[1]["seasons"][0]["monitored"])

    def test_concurrent_specials_and_scheduled_unmonitor_do_not_restore_retired_regular_season(self):
        self.select_exception()
        specials_read_series = threading.Event()
        resume_specials = threading.Event()
        normal_done = threading.Event()
        failures = []
        original_api = self.api_request

        def interleaved_api(base_url, api_key, endpoint, method="GET", data=None):
            if (threading.current_thread().name == "specials-action"
                    and method == "GET" and endpoint == "episode?seriesId=1"):
                specials_read_series.set()
                if not resume_specials.wait(3):
                    raise AssertionError("Specials action did not resume")
            return original_api(base_url, api_key, endpoint, method, data)

        def run_specials():
            try:
                self.apply()
            except Exception as error:
                failures.append(error)

        def run_normal():
            try:
                arr_mgmt.perform_sonarr_unmonitor(arr_mgmt.load_config(), source="scheduled")
            except Exception as error:
                failures.append(error)
            finally:
                normal_done.set()

        with patch.object(arr_mgmt, "api_request", side_effect=interleaved_api):
            specials = threading.Thread(target=run_specials, name="specials-action")
            normal = threading.Thread(target=run_normal, name="normal-unmonitor")
            specials.start()
            try:
                self.assertTrue(specials_read_series.wait(2))
                normal.start()
                # Without serialization the normal run finishes while Specials
                # holds an old series snapshot, which would resurrect season 1.
                normal_done.wait(0.2)
            finally:
                resume_specials.set()
                specials.join(3)
                if normal.ident is not None:
                    normal.join(3)
        self.assertFalse(specials.is_alive())
        self.assertFalse(normal.is_alive())
        self.assertEqual(failures, [])
        self.assertFalse(self.series[1]["seasons"][1]["monitored"])
        self.assertTrue(self.series[1]["seasons"][0]["monitored"])
        self.assertTrue(self.series[1]["monitored"])

    def test_failed_episode_update_does_not_search_or_log_success_for_exception(self):
        self.select_exception()
        self.failures.add(("PUT", "episode/monitor"))
        result = self.apply()
        self.assertFalse(result["success"])
        self.assertEqual(result["monitored_count"], 0)
        self.assertEqual(result["search_count"], 0)
        self.assertEqual(self.commands, [])
        self.assertFalse(self.series[1]["monitored"])
        self.assertEqual(arr_mgmt.load_unmonitor_log(), [])

    def test_failed_parent_update_prevents_search_but_reports_successful_episode_changes(self):
        self.select_exception()
        self.failures.add(("PUT", "series/1"))
        result = self.apply()
        self.assertFalse(result["success"])
        self.assertEqual(result["monitored_count"], 2)
        self.assertEqual(result["search_count"], 0)
        self.assertEqual(self.commands, [])
        self.assertTrue(result["errors"])

    def test_failed_search_keeps_monitoring_and_reports_error(self):
        self.select_exception()
        self.failures.add(("POST", "command"))
        result = self.apply()
        self.assertFalse(result["success"])
        self.assertEqual(result["monitored_count"], 2)
        self.assertEqual(result["search_count"], 0)
        self.assertTrue(self.episodes[1][0]["monitored"])
        self.assertTrue(result["errors"])

    def test_scan_is_read_only_and_selection_persists_without_immediate_search(self):
        before = deepcopy((self.series, self.episodes))
        response = self.client.get("/api/sonarr/specials?scan=true")
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(len(data["shows"]), 2)
        self.assertEqual(data["shows"][1]["special_count"], 2)
        self.assertEqual(data["shows"][1]["missing_count"], 1)
        response = self.client.post("/api/sonarr/specials", json={"id": 1, "enabled": True})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(arr_mgmt.load_config()["sonarr_specials_exceptions"], [{"id": 1, "title": "Exception Show"}])
        self.assertEqual((self.series, self.episodes), before)
        self.assertEqual(self.commands, [])
        self.assertTrue(self.client.get("/api/sonarr/specials").get_json()["shows"][0]["exception"])
        self.client.post("/api/sonarr/specials", json={"id": 1, "enabled": False})
        self.assertEqual(arr_mgmt.load_config()["sonarr_specials_exceptions"], [])

    def test_exception_validation_and_offline_removal(self):
        for payload in [None, [], {"id": True, "enabled": True}, {"id": 1, "enabled": "yes"}]:
            with self.subTest(payload=payload):
                self.assertEqual(self.client.post("/api/sonarr/specials", json=payload).status_code, 400)
        self.assertEqual(self.client.post("/api/sonarr/specials", json={"id": 999, "enabled": True}).status_code, 404)
        self.select_exception()
        self.failures.add(("GET", "series"))
        response = self.client.post("/api/sonarr/specials", json={"id": 1, "enabled": False})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(arr_mgmt.load_config()["sonarr_specials_exceptions"], [])

    def test_scan_and_action_surface_read_failures_and_preserve_existing_state(self):
        self.select_exception()
        self.failures.add(("GET", "episode?seriesId=1"))
        before = deepcopy((self.series[1], self.episodes[1]))
        data = self.client.get("/api/sonarr/specials?scan=true").get_json()
        self.assertEqual(data["failed_series"], ["Exception Show"])
        self.assertTrue(next(show for show in data["shows"] if show["id"] == 1)["exception"])
        result = self.apply()
        self.assertFalse(result["success"])
        self.assertEqual((self.series[1], self.episodes[1]), before)
        self.assertEqual(self.commands, [])


if __name__ == "__main__":
    unittest.main()
