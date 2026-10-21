"""`/api/telemetry/` — the cluster and Vehicle screen's only source.

v2's SCS adapter returns the legacy dashboard shape.  v3 adds the derived values
the physical UI needs (mph, fuel percent, a gear label) here, in one place, so
the templates never do arithmetic and never invent a reading.
"""
from __future__ import annotations

from flask import Blueprint, jsonify

from ..services import v2link
from ..services.trip import trip_meter
from ._values import boolean, integer, number

telemetry_bp = Blueprint("telemetry", __name__)

_EMPTY_TRUCK = {
    "speedKmh": None, "speedMph": None, "rpm": None,
    "gear": None, "gearLabel": None, "coolant": None, "oil": None,
    "battery": None, "fuel": None, "fuelCapacity": None, "fuelPercent": None,
    "x": None, "y": None, "heading": None,
    "motorBrake": None, "retarder": None,
    "liftAxle": None, "trailerLiftAxle": None,
    "speedLimit": None, "cruise": None,
    "lights": {
        "left": None, "right": None, "high": None,
        "low": None, "parking": None, "beacon": None,
    },
}


def _gear_label(value) -> str | None:
    gear = integer(value)
    if gear is None:
        return None
    if gear < 0:
        return "R"
    if gear == 0:
        return "N"
    return str(gear)


def snapshot() -> dict:
    """One honest payload: null where the plugin did not publish a value."""
    adapter = v2link.telemetry()
    if adapter is None:
        return {
            "game": {
                "connected": False, "name": None, "active": False,
                "status": "v2 bridge unavailable", "partial": False,
                "error": v2link.status().get("error"),
            },
            "truck": dict(_EMPTY_TRUCK),
        }

    raw = adapter.snapshot()
    game = raw.get("game") or {}
    truck = raw.get("truck") or {}
    connected = bool(game.get("connected"))
    active = bool((raw.get("telemetry") or {}).get("active"))

    speed_kmh = number(truck.get("speed"))
    fuel = number(truck.get("fuel"))
    capacity = number(truck.get("fuelCapacity"))
    percent = None
    if fuel is not None and capacity:
        percent = max(0.0, min(100.0, fuel / capacity * 100.0))

    payload = {
        "game": {
            "connected": connected,
            "name": game.get("gameName"),
            "active": active,
            "status": adapter.status,
            "partial": boolean((raw.get("telemetry") or {}).get("partial")),
            "error": raw.get("error"),
        },
        "truck": {
            "speedKmh": speed_kmh,
            "speedMph": None if speed_kmh is None else speed_kmh * 0.621371,
            "rpm": number(truck.get("engineRpm")),
            "gear": integer(truck.get("displayedGear")),
            "gearLabel": _gear_label(truck.get("displayedGear")),
            "coolant": number(truck.get("waterTemperature")),
            "oil": number(truck.get("oilPressure")),
            "battery": number(truck.get("batteryVoltage")),
            "fuel": fuel,
            "fuelCapacity": capacity,
            "fuelPercent": percent,
            "x": number(truck.get("coordinateX")),
            "y": number(truck.get("coordinateY")),
            "heading": number(truck.get("heading")),
            "motorBrake": boolean(truck.get("motorBrake")),
            "retarder": integer(truck.get("retarderLevel")),
            "liftAxle": boolean(truck.get("liftAxle")),
            "trailerLiftAxle": boolean(truck.get("trailerLiftAxle")),
            "speedLimit": number(truck.get("navSpeedLimit")),
            "cruise": number(truck.get("cruiseControl")),
            "lights": {
                "left": boolean(truck.get("leftBlinker")),
                "right": boolean(truck.get("rightBlinker")),
                "high": boolean(truck.get("highBeam")),
                "low": boolean(truck.get("lowBeam")),
                "parking": boolean(truck.get("parkingLights")),
                "beacon": boolean(truck.get("beacon")),
            },
        },
    }
    return payload


@telemetry_bp.get("/")
def current():
    """The live snapshot, and the clock the trip meter samples on.

    The deck already polls this endpoint once a second, so folding the sample in
    here means one reader of shared memory instead of a second background
    thread racing the first.
    """
    data = snapshot()
    trip_meter.sample(data["truck"], data["game"]["connected"], data["game"]["active"])
    return jsonify(data)


@telemetry_bp.get("/position")
def position():
    """Slim pos/heading readback for external clients; does not advance the trip."""
    data = snapshot()
    truck = data["truck"]
    return jsonify({
        "x": truck["x"], "y": truck["y"], "heading": truck["heading"],
        "speedKmh": truck["speedKmh"], "connected": data["game"]["connected"],
    })


@telemetry_bp.get("/diag")
def diag():
    adapter = v2link.telemetry()
    if adapter is None:
        return jsonify({
            "source": "scs_sdk", "plugin_loaded": False, "connected": False,
            "error": v2link.status().get("error"),
        })
    data = adapter.diagnostics()
    data["source"] = "scs_sdk"
    return jsonify(data)
