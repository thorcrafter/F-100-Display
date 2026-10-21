"""Page routing for the deck.

    /                          → the default app's default MFD screen
    /ats/                      → /ats/media/
    /ats/media/                → the deck with Media on the MFD
    /ats/trip/                 → the same deck, Trip on the MFD

There is one page in v3 — the deck — and the URL only says which MFD view is
showing.  That keeps deep links, the back button and a plain `<a href>` working,
which is the part of v2's shell worth keeping.
"""
from __future__ import annotations

from flask import Blueprint, abort, redirect, render_template, request

from .config import settings
from .registry import APPS, get_app

pages_bp = Blueprint("pages", __name__)

#: JSON surfaces the deck talks to, in one place so no module hardcodes a path.
API = {
    "apps": "/api/apps/",
    "health": "/api/apps/health",
    "telemetry": "/api/telemetry/",
    "position": "/api/telemetry/position",
    "diag": "/api/telemetry/diag",
    "controls": "/api/controls/",
    "media": "/api/media/",
    "trip": "/api/trip/",
    "tripReset": "/api/trip/reset",
}


def _boot(app, screen) -> dict:
    """The `#deck-boot` payload: identity, URLs and endpoints."""
    return {
        "version": settings.VERSION,
        "app": app.id,
        "appName": app.name,
        "short": app.short,
        "theme": app.theme,
        "accent": app.accent,
        "units": app.units,
        "provider": app.provider,
        "screen": screen.id,
        "host": request.host,
        "screens": [
            {
                "id": item.id,
                "label": item.label,
                "icon": item.icon,
                "blurb": item.blurb,
                "hint": item.hint,
                "href": app.href(item),
            }
            for item in app.screens
        ],
        "api": API,
    }


def _ctx(app, screen):
    return {
        "app": app,
        "screen": screen,
        "screens": app.screens,
        "apps": APPS,
        "title": settings.TITLE,
        "boot": _boot(app, screen),
    }


@pages_bp.get("/")
def index():
    first = APPS[0]
    return redirect(first.href())


@pages_bp.get("/<app_id>/")
def app_root(app_id: str):
    app = get_app(app_id)
    if app is None or app.default_screen is None:
        abort(404)
    return redirect(app.href())


@pages_bp.get("/<app_id>/<screen_id>/")
def screen_view(app_id: str, screen_id: str):
    app = get_app(app_id)
    screen = app.screen(screen_id) if app else None
    if app is None or screen is None:
        abort(404)
    return render_template("deck.html", **_ctx(app, screen))


@pages_bp.app_errorhandler(404)
def not_found(error):  # pragma: no cover - exercised through the browser
    if request.path.startswith("/api/"):
        return {"error": "not found", "path": request.path}, 404
    return render_template("404.html", title=settings.TITLE), 404
