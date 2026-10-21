"""`/api/trip/` — the Trip screen's readback and its reset.

The meter is fed by `/api/telemetry/`; this route only reads it.  Reset is a
POST because it changes state the user can see.
"""
from __future__ import annotations

from flask import Blueprint, jsonify

from ..services.trip import trip_meter

trip_bp = Blueprint("trip", __name__)


@trip_bp.get("/")
def current():
    return jsonify(trip_meter.snapshot())


@trip_bp.post("/reset")
def reset():
    return jsonify(trip_meter.reset())
