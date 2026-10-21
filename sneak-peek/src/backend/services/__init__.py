"""Background services the deck needs on start-up.

Only one: the media mirror polls the OS media session, so without `start()` the
Media screen can only ever say "no source".  It is idempotent.
"""
from __future__ import annotations

from . import v2link

_started = False


def start_services() -> None:
    global _started
    if _started:
        return
    _started = True
    v2link.start()
