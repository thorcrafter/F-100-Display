"""v3 checks — run with the checkout's Python, no extra test dependency.

    .venv/Scripts/python.exe -m unittest discover -s v3/tests -v

The tests are deliberately about the deck's contract, not its pixels:

* every registered screen is reachable and carries a boot payload
* v3 reads and serves **no** map data: no bundle, no map route, no /mapfiles
* the trip meter only integrates what the position readback published, ignores
  teleports, and reports game kilometres with the world's ×19 scale
* telemetry keeps "not published" as null and derives only what it can
* the media poll never carries a 100 KB data URL
"""
from __future__ import annotations

import json
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT / "v3") not in sys.path:
    sys.path.insert(0, str(ROOT / "v3"))

from backend.app import create_app  # noqa: E402
from backend.config import settings  # noqa: E402
from backend.registry import APPS  # noqa: E402
from backend.services.trip import GAME_SCALE, TripMeter  # noqa: E402

BOOT_RE = re.compile(
    r'<script type="application/json" id="deck-boot">(.*?)</script>', re.S
)


class DeckCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.app = create_app()
        cls.app.testing = True
        cls.client = cls.app.test_client()


class RegistryTests(DeckCase):
    def test_two_apps_six_screens_each(self):
        self.assertEqual([app.id for app in APPS], ["ats", "ets"])
        for app in APPS:
            self.assertEqual(len(app.screens), 6)
            self.assertEqual(
                [screen.id for screen in app.screens],
                ["media", "climate", "trip", "vehicle", "phone", "setup"],
            )

    def test_payload_matches_registry(self):
        body = self.client.get("/api/apps/").get_json()
        self.assertEqual(body["version"], settings.VERSION)
        self.assertEqual(len(body["apps"]), len(APPS))
        for record, app in zip(body["apps"], APPS):
            self.assertEqual(record["id"], app.id)
            self.assertEqual(record["href"], app.href())
            self.assertNotIn("world", record)
            self.assertEqual(len(record["screens"]), len(app.screens))
            for screen, payload in zip(app.screens, record["screens"]):
                self.assertEqual(payload["href"], f"/{app.id}/{screen.id}/")


class PageTests(DeckCase):
    def test_root_and_app_root_redirect_to_a_screen(self):
        root = self.client.get("/")
        self.assertEqual(root.status_code, 302)
        self.assertEqual(root.headers["Location"], "/ats/media/")
        app_root = self.client.get("/ets/")
        self.assertEqual(app_root.status_code, 302)
        self.assertEqual(app_root.headers["Location"], "/ets/media/")

    def test_every_screen_renders_with_its_boot_payload(self):
        for app in APPS:
            for screen in app.screens:
                path = f"/{app.id}/{screen.id}/"
                with self.subTest(path=path):
                    response = self.client.get(path)
                    self.assertEqual(response.status_code, 200)
                    html = response.get_data(as_text=True)
                    self.assertIn(f'data-screen="{screen.id}"', html)
                    match = BOOT_RE.search(html)
                    self.assertIsNotNone(match, "boot payload missing")
                    boot = json.loads(match.group(1))
                    self.assertEqual(boot["app"], app.id)
                    self.assertEqual(boot["screen"], screen.id)
                    self.assertEqual(boot["units"], app.units)
                    self.assertEqual(boot["api"]["telemetry"], "/api/telemetry/")
                    self.assertEqual(boot["api"]["trip"], "/api/trip/")
                    self.assertEqual(len(boot["screens"]), len(app.screens))

    def test_unknown_screen_404s_and_api_stays_json(self):
        page = self.client.get("/ats/nope/")
        self.assertEqual(page.status_code, 404)
        self.assertIn("not on this deck", page.get_data(as_text=True))
        api = self.client.get("/api/apps/nope")
        self.assertEqual(api.status_code, 404)
        self.assertEqual(api.get_json()["error"], "not found")


class NoMapDataTests(DeckCase):
    def test_no_map_routes_and_no_bundle_folder(self):
        self.assertFalse(hasattr(settings, "MAP_DATA"))
        for path in ("/api/map/", "/mapfiles/map.json", "/mapfiles/map.bin"):
            with self.subTest(path=path):
                # The generic page rule answers `/x/y` with a 308 to `/x/y/`;
                # what matters is that no bundle is ever served.
                response = self.client.get(path, follow_redirects=True)
                self.assertEqual(response.status_code, 404)
        self.assertFalse((ROOT / "v3" / "frontend" / "static" / "map").exists(),
                         "v3 must not carry map data")

    def test_pages_and_boot_never_mention_a_map_bundle(self):
        for path in ("/ats/trip/", "/ats/setup/"):
            with self.subTest(path=path):
                html = self.client.get(path).get_data(as_text=True)
                for needle in ("mapfiles", "map.bin", "map.json", "MAP BUNDLE"):
                    self.assertNotIn(needle, html)
                boot = json.loads(BOOT_RE.search(html).group(1))
                self.assertNotIn("map", boot)
                self.assertEqual(boot["api"]["tripReset"], "/api/trip/reset")

    def test_health_reports_trip_instead_of_map(self):
        body = self.client.get("/api/apps/health").get_json()
        self.assertNotIn("map", body)
        self.assertIn("trip", body)
        self.assertEqual(set(body["trip"]),
                         {"active", "distance_km", "driving_s", "segments", "samples"})
        self.assertEqual(body["api"]["trip"], "/api/trip/")


class TripMathTests(unittest.TestCase):
    def test_distance_uses_the_world_scale_and_reports_world_speed(self):
        meter = TripMeter()
        meter.sample({"x": 0.0, "y": 0.0, "speedKmh": 72.0, "fuel": 300.0},
                     True, True, now=100.0)
        meter.sample({"x": 100.0, "y": 0.0, "speedKmh": 72.0, "fuel": 290.0},
                     True, True, now=105.0)
        trip = meter.snapshot()
        self.assertAlmostEqual(trip["distance_m"], 100.0, places=1)
        self.assertAlmostEqual(trip["distance_km"], 100.0 * GAME_SCALE / 1000.0, places=2)
        self.assertEqual(trip["driving_s"], 5)
        # 100 world m in 5 s is 72 km/h — the scale cancels for average speed.
        self.assertAlmostEqual(trip["avg_kmh"], 72.0, places=1)
        self.assertEqual(trip["fuel_used_l"], 10.0)
        self.assertAlmostEqual(trip["economy_l_100km"], 10.0 / 1.9 * 100.0, places=1)
        self.assertEqual(trip["segments"], 1)
        self.assertEqual(len(trip["trace"]), 2)
        self.assertTrue(trip["active"])

    def test_a_teleport_starts_a_segment_instead_of_inventing_road(self):
        meter = TripMeter()
        meter.sample({"x": 0.0, "y": 0.0, "speedKmh": 72.0}, True, True, now=100.0)
        meter.sample({"x": 100.0, "y": 0.0, "speedKmh": 72.0}, True, True, now=105.0)
        meter.sample({"x": 5000.0, "y": 0.0, "speedKmh": 72.0}, True, True, now=106.0)
        trip = meter.snapshot()
        self.assertEqual(trip["segments"], 2)
        self.assertAlmostEqual(trip["distance_m"], 100.0, places=1)
        self.assertEqual(len(trip["trace"]), 1)

    def test_a_closed_game_stops_the_clock_and_breaks_the_line(self):
        meter = TripMeter()
        meter.sample({"x": 0.0, "y": 0.0, "speedKmh": 50.0}, True, True, now=100.0)
        meter.sample({"x": 20.0, "y": 0.0, "speedKmh": 50.0}, True, True, now=102.0)
        before = meter.snapshot()["driving_s"]
        meter.sample({}, False, False, now=110.0)
        self.assertFalse(meter.snapshot()["active"])
        self.assertEqual(meter.snapshot()["driving_s"], before)
        # Reconnect far away: no dt means no impossible straight line.
        meter.sample({"x": 9000.0, "y": 9000.0, "speedKmh": 50.0}, True, True, now=140.0)
        trip = meter.snapshot()
        self.assertAlmostEqual(trip["distance_m"], 20.0, places=1)
        self.assertEqual(trip["segments"], 1)

    def test_reset_clears_the_trip_and_keeps_a_counter(self):
        meter = TripMeter()
        meter.sample({"x": 0.0, "y": 0.0, "speedKmh": 30.0}, True, True, now=1.0)
        meter.sample({"x": 10.0, "y": 0.0, "speedKmh": 30.0}, True, True, now=2.0)
        trip = meter.reset()
        self.assertEqual(trip["samples"], 0)
        self.assertEqual(trip["distance_m"], 0.0)
        self.assertEqual(trip["trace"], [])
        self.assertIsNone(trip["started"])
        self.assertEqual(trip["resets"], 1)

    def test_unpublished_readings_stay_null(self):
        meter = TripMeter()
        meter.sample({}, True, True, now=1.0)
        trip = meter.snapshot()
        self.assertIsNone(trip["avg_kmh"])
        self.assertIsNone(trip["max_kmh"])
        self.assertIsNone(trip["fuel_used_l"])
        self.assertIsNone(trip["economy_l_100km"])
        self.assertEqual(trip["distance_m"], 0.0)


class TripApiTests(DeckCase):
    def test_trip_snapshot_has_the_trace_contract(self):
        body = self.client.get("/api/trip/").get_json()
        self.assertIn("distance_km", body)
        self.assertIn("distance_m", body)
        self.assertEqual(body["game_scale"], GAME_SCALE)
        self.assertIsInstance(body["trace"], list)
        self.assertIn("no map data", body["note"])

    def test_reset_is_a_post_that_returns_the_empty_trip(self):
        self.assertEqual(self.client.get("/api/trip/reset").status_code, 405)
        response = self.client.post("/api/trip/reset")
        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertEqual(body["samples"], 0)
        self.assertEqual(body["distance_km"], 0.0)
        self.assertEqual(body["trace"], [])


class DataTests(DeckCase):
    def test_telemetry_keeps_unknowns_null_and_derives_consistently(self):
        body = self.client.get("/api/telemetry/").get_json()
        self.assertIn("game", body)
        self.assertIn("truck", body)
        truck = body["truck"]
        self.assertEqual(
            set(truck),
            {
                "speedKmh", "speedMph", "rpm", "gear", "gearLabel", "coolant",
                "oil", "battery", "fuel", "fuelCapacity", "fuelPercent",
                "x", "y", "heading", "motorBrake", "retarder",
                "liftAxle", "trailerLiftAxle", "speedLimit", "cruise", "lights",
            },
        )
        if truck["speedKmh"] is not None:
            self.assertAlmostEqual(truck["speedMph"], truck["speedKmh"] * 0.621371, places=4)
        if truck["fuelPercent"] is not None:
            self.assertGreaterEqual(truck["fuelPercent"], 0.0)
            self.assertLessEqual(truck["fuelPercent"], 100.0)

    def test_controls_expose_the_wire_actions(self):
        body = self.client.get("/api/controls/").get_json()
        self.assertEqual(len(body["actions"]), 24)
        self.assertIn("retarder_up", body["actions"])
        self.assertIn("front_suspension_up", body["hold_actions"])
        self.assertIn("available", body)

    def test_unknown_control_is_refused_without_touching_the_game(self):
        response = self.client.post("/api/controls/not_a_real_action", json={"pressed": True})
        self.assertIn(response.status_code, (400, 409, 503))
        self.assertIn("error", response.get_json())

    def test_media_poll_has_no_data_url(self):
        body = self.client.get("/api/media/").get_json()
        self.assertNotIn("artwork_dataurl", body)
        self.assertIn("available", body)
        self.assertIn("artwork", body)
        if body.get("artwork"):
            self.assertEqual(body["artwork"], "/api/media/art")
            self.assertTrue(body.get("artwork_key"))
        art = self.client.get("/api/media/art")
        self.assertIn(art.status_code, (200, 404, 503))


if __name__ == "__main__":
    unittest.main()
