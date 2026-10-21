"""v2's live bridges, loaded in place instead of copied.

The SCS shared-memory protocol (the 288-byte struct and its 24 input indices)
and the Spotify desktop mirror are the two pieces of v2 that talk to the
machine.  Copying them into v3 would create a second wire protocol to keep in
sync, which is exactly the drift v2 was written to end.  So v3 loads those
modules from `v2/backend/services/` under a private package name and re-exports
their singletons.

What v3 does *not* touch: v2's Flask app, its routes, its writable data.  Only
these leaf modules, which import nothing from v2's config.
"""
from __future__ import annotations

import importlib.util
import sys
import threading
import types

from ..config import settings

_PKG = "f100_v2_services"
_LOCK = threading.Lock()
_MODULES: dict[str, types.ModuleType] = {}
_ERROR: str | None = None
_LOADED = False

#: Leaf modules v3 needs.  `scs_sdk` imports `.truck_controls`, so the package
#: shim below has to be in `sys.modules` before either file executes.
_NAMES = ("truck_controls", "scs_sdk", "spotify_bridge")


def _load() -> None:
    global _ERROR, _LOADED
    with _LOCK:
        if _LOADED:
            return
        _LOADED = True
        root = settings.V2 / "backend" / "services"
        if not root.is_dir():
            _ERROR = f"v2 services not found at {root}"
            return
        package = types.ModuleType(_PKG)
        package.__path__ = [str(root)]
        package.__package__ = _PKG
        sys.modules[_PKG] = package
        try:
            for name in _NAMES:
                path = root / f"{name}.py"
                if not path.is_file():
                    raise FileNotFoundError(path)
                qualified = f"{_PKG}.{name}"
                spec = importlib.util.spec_from_file_location(qualified, path)
                if spec is None or spec.loader is None:
                    raise ImportError(f"cannot load {path}")
                module = importlib.util.module_from_spec(spec)
                sys.modules[qualified] = module
                spec.loader.exec_module(module)
                _MODULES[name] = module
        except Exception as error:  # a broken v2 must not take the deck down
            _ERROR = f"{type(error).__name__}: {error}"
            _MODULES.clear()


def _module(name: str) -> types.ModuleType | None:
    _load()
    return _MODULES.get(name)


def bridge() -> object | None:
    """`truck_controls.truck_controls` — shared-memory command/telemetry ring."""
    module = _module("truck_controls")
    return getattr(module, "truck_controls", None) if module else None


def telemetry() -> object | None:
    """`scs_sdk.telemetry` — the console-shaped SCS snapshot."""
    module = _module("scs_sdk")
    return getattr(module, "telemetry", None) if module else None


def media() -> object | None:
    """`spotify_bridge.spotify` — GSMTC mirror + media-key injection."""
    module = _module("spotify_bridge")
    return getattr(module, "spotify", None) if module else None


def actions() -> tuple[str, ...]:
    """The SCS input actions the plugin understands, in wire order."""
    module = _module("truck_controls")
    table = getattr(module, "ACTIONS", None) if module else None
    return tuple(table) if table else ()


def start() -> None:
    """Start the media poller once.  Safe to call on every app factory run."""
    poller = media()
    if poller is not None:
        try:
            poller.start()
        except Exception:
            # The mirror is optional; a machine without GSMTC still gets a deck.
            pass


def status() -> dict:
    """What v2's bridge files are, for Setup and `/api/apps/health`."""
    _load()
    return {
        "source": str(settings.V2 / "backend" / "services"),
        "available": bool(_MODULES),
        "modules": sorted(_MODULES),
        "error": _ERROR,
    }
