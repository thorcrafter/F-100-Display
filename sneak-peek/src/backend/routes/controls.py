"""`/api/controls/` — the rack's write path.

Every switch on the rack posts here.  The route is deliberately thin: the v2
shared-memory bridge owns the protocol, the queue, the pause handling and the
truthful "why is this unavailable" strings.  v3 only refuses unknown actions and
translates the bridge's errors into HTTP.
"""
from __future__ import annotations

from flask import Blueprint, jsonify, request

from ..services import v2link

controls_bp = Blueprint("controls", __name__)

HOLD_ACTIONS = frozenset({
    "front_suspension_up", "front_suspension_down",
    "rear_suspension_up", "rear_suspension_down",
})


def _snapshot() -> dict:
    service = v2link.bridge()
    if service is None:
        return {
            "available": False,
            "game_active": False,
            "error": v2link.status().get("error") or "v2 controls bridge unavailable",
        }
    try:
        return service.snapshot()
    except Exception as exc:
        return {
            "available": False,
            "game_active": False,
            "error": f"{type(exc).__name__}: {exc}",
        }


@controls_bp.get("/")
def status():
    entry = _snapshot()
    return jsonify({
        **entry,
        "actions": list(v2link.actions()),
        "hold_actions": sorted(HOLD_ACTIONS),
    })


@controls_bp.post("/<action>")
def send(action: str):
    body = request.get_json(silent=True) or {}
    pressed = body.get("pressed", True)
    if not isinstance(pressed, bool):
        return jsonify(error="pressed must be a boolean"), 400

    service = v2link.bridge()
    if service is None:
        return jsonify(error=v2link.status().get("error") or "bridge unavailable"), 503
    try:
        return jsonify(service.send(action, pressed=pressed))
    except ValueError as exc:
        return jsonify(error=str(exc), action=action), 400
    except RuntimeError as exc:
        return jsonify(error=str(exc), action=action), 409
