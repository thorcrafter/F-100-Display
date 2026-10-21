"""`/api/media/` — the MFD's Media screen.

Read side is v2's GSMTC mirror (whatever the OS says Spotify is playing), write
side is the same media-key injection v2 uses.  No artwork lookup and no Web API
sign-in in v3: the screen says what the desktop says, and says so when the
desktop is not telling it anything.
"""
from __future__ import annotations

import base64
import hashlib
import sys

from flask import Blueprint, Response, jsonify, request

from ..services import v2link

media_bp = Blueprint("media", __name__)

_TRANSPORT = {"play_pause", "next", "prev"}


def _source() -> object | None:
    return v2link.media()


@media_bp.get("/")
def now_playing():
    source = _source()
    if source is None:
        return jsonify({
            "available": False,
            "title": None, "artist": None, "album": None,
            "position": 0, "duration": 0, "is_playing": False,
            "source": None, "platform": sys.platform,
            "error": v2link.status().get("error") or "media mirror unavailable",
        })
    try:
        track = source.snapshot()
    except Exception as exc:
        return jsonify({
            "available": False, "title": None, "artist": None, "album": None,
            "position": 0, "duration": 0, "is_playing": False,
            "source": None, "platform": sys.platform,
            "error": f"{type(exc).__name__}: {exc}",
        })
    title = track.get("title")
    available = bool(title and title != "—")
    # Artwork is a data URL of ~100 KB.  Keep it out of the twice-a-second poll
    # and hand the screen a cached image URL instead.
    artwork = track.pop("artwork_dataurl", "") or ""
    key = hashlib.sha1(artwork.encode("utf-8")).hexdigest()[:12] if artwork else None
    return jsonify({
        **track,
        "available": available,
        "artwork": "/api/media/art" if artwork else None,
        "artwork_key": key,
        "platform": sys.platform,
        "error": None if available else "No media session on this machine.",
    })


@media_bp.get("/art")
def artwork():
    """The mirror's album art, decoded once per request and cached by key."""
    source = _source()
    if source is None:
        return jsonify(error="media mirror unavailable"), 404
    try:
        dataurl = source.snapshot().get("artwork_dataurl") or ""
    except Exception as exc:
        return jsonify(error=f"{type(exc).__name__}: {exc}"), 503
    if not dataurl.startswith("data:") or "," not in dataurl:
        return jsonify(error="no artwork in the current session"), 404
    header, _, payload = dataurl.partition(",")
    mimetype = header[5:].split(";")[0] or "image/png"
    try:
        blob = base64.b64decode(payload)
    except (ValueError, TypeError):
        return jsonify(error="artwork is not valid base64"), 502
    response = Response(blob, mimetype=mimetype)
    response.headers["Cache-Control"] = "public, max-age=60"
    return response


@media_bp.post("/transport/<action>")
def transport(action: str):
    if action not in _TRANSPORT:
        return jsonify(error=f"unsupported transport action '{action}'"), 404
    source = _source()
    if source is None:
        return jsonify(error="media mirror unavailable"), 503
    try:
        source.send_media_key(action)
    except Exception as exc:
        return jsonify(error=f"{type(exc).__name__}: {exc}", action=action), 503
    return jsonify(ok=True, action=action)


@media_bp.post("/search")
def search():
    """Open the desktop client's search page — no auth involved."""
    query = (request.get_json(silent=True) or {}).get("q", "").strip()
    source = _source()
    if source is None:
        return jsonify(ok=False, error="media mirror unavailable"), 503
    if query:
        try:
            source.search(query)
        except Exception as exc:
            return jsonify(ok=False, error=f"{type(exc).__name__}: {exc}"), 503
    return jsonify(ok=bool(query))
