"""Application factory for the v3 deck.

Templates and static files come from the v3 tree (`v3/backend/templates`,
`v3/frontend/static`), so edits are live on the next reload.  The only thing v3
shares with v2 is the live bridges — the SCS shared-memory service and the OS
media mirror — loaded in place, never copied.  No map bundle is read, served or
copied: the Trip screen dead-reckons from the position readback.
"""
from __future__ import annotations

from flask import Flask, redirect, request

from .config import settings
from .pages import pages_bp
from .routes.apps import apps_bp
from .routes.controls import controls_bp
from .routes.media import media_bp
from .routes.telemetry import telemetry_bp
from .routes.trip import trip_bp
from .services import start_services

#: (blueprint, url prefix) — every JSON surface the deck exposes.
API_BLUEPRINTS = (
    (apps_bp, "/api/apps"),
    (controls_bp, "/api/controls"),
    (media_bp, "/api/media"),
    (telemetry_bp, "/api/telemetry"),
    (trip_bp, "/api/trip"),
)


def create_app() -> Flask:
    app = Flask(
        __name__,
        template_folder=str(settings.TEMPLATES),
        static_folder=str(settings.STATIC),
        static_url_path="/static",
    )
    app.config.update(
        TEMPLATES_AUTO_RELOAD=True,
        SEND_FILE_MAX_AGE_DEFAULT=0,
        JSON_SORT_KEYS=False,
    )
    app.jinja_env.auto_reload = True

    for blueprint, prefix in API_BLUEPRINTS:
        app.register_blueprint(blueprint, url_prefix=prefix)
    app.register_blueprint(pages_bp)

    # The media mirror is a poller; it is idempotent so a reloaded dev server
    # does not stack threads.
    start_services()

    @app.get("/favicon.ico")
    def favicon():
        return redirect("/static/favicon.svg")

    @app.after_request
    def _live_data_is_not_cached(response):
        """Telemetry, trip, controls and media must never come from the cache."""
        if request.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
            response.headers["Pragma"] = "no-cache"
        return response

    return app
