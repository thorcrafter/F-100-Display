"""`/api/apps/` — the registry and the deck's health.

One payload feeds the physical app keys, the MFD rail and the diagnostics
screen, so they cannot disagree about what exists.
"""
from __future__ import annotations

from flask import Blueprint, jsonify

from .. import registry
from ..config import settings
from ..services import v2link
from ..services.trip import trip_meter
from ._values import boolean

apps_bp = Blueprint("apps", __name__)


def trip_state() -> dict:
    """A slim trip summary; the 300-point trace stays on `/api/trip/`."""
    snapshot = trip_meter.snapshot()
    return {
        key: snapshot[key]
        for key in ("active", "distance_km", "driving_s", "segments", "samples")
    }


def bridge_state() -> dict:
    """SCS plugin / game state, through v2's adapter."""
    link = v2link.status()
    telemetry = v2link.telemetry()
    diagnostics = {}
    if telemetry is not None:
        try:
            diagnostics = telemetry.diagnostics()
        except Exception as exc:  # a wedged plugin must not break health
            diagnostics = {"error": f"{type(exc).__name__}: {exc}"}
    return {
        **link,
        "plugin_loaded": bool(diagnostics.get("plugin_loaded")),
        "connected": bool(diagnostics.get("connected")),
        "game_active": bool(diagnostics.get("game_active")),
        "game_name": diagnostics.get("game_name"),
        "partial": boolean(diagnostics.get("partial")),
        "status": diagnostics.get("error") or (
            "linked" if diagnostics.get("connected") else "no plugin"
        ),
    }


@apps_bp.get("/")
def list_apps():
    return jsonify({"version": settings.VERSION, "apps": registry.apps_payload()})


@apps_bp.get("/health")
def health():
    bridge = bridge_state()
    media = v2link.media()
    media_source = None
    if media is not None:
        try:
            snapshot = media.snapshot()
            media_source = snapshot.get("source") or None
        except Exception:
            media_source = None
    return jsonify({
        "app": "v3",
        "version": settings.VERSION,
        "registry": {"apps": len(registry.APPS), "source": "backend/registry.py"},
        "bridge": bridge,
        "trip": trip_state(),
        "media": {"source": media_source},
        "api": {
            "telemetry": "/api/telemetry/",
            "controls": "/api/controls/",
            "media": "/api/media/",
            "trip": "/api/trip/",
        },
    })
