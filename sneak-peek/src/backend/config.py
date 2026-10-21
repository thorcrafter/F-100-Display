"""Runtime configuration for the v3 deck.

v3 is the hardware-finish rebuild of the console: the HD·Controls rack, the
instrument cluster and the MFD are the interface, so the settings are smaller
than v2's.  Two rules still apply, for the same reasons:

* **A relative path in an environment variable resolves against the checkout
  root**, because `.env` sits at the top of the checkout.
* **v3 owns only its own writable data** (`v3/data`).  It has no map setting at
  all: the deck reads no world bundle, so there is nothing to point at.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

# backend/config.py → backend/ → v3/ → the checkout.
BACKEND = Path(__file__).resolve().parent
V3 = BACKEND.parent
ROOT = V3.parent

#: Variables that were already set when the process started.  An explicit
#: `CONSOLE_PORT=…` beats every file.
_FROM_PROCESS = set(os.environ)


def _load_env_file(path: Path, *, override: bool = False) -> None:
    """Load a tiny KEY=VALUE file. Real environment variables always win."""
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip("'\"")
        if key in _FROM_PROCESS:
            continue
        if override or key not in os.environ:
            os.environ[key] = value


# The checkout `.env` carries shared credentials (Spotify), then `v3/.env`
# layers v3's own port and folders on top.  Without the second pass v3 would
# inherit v2's port and the two servers would fight over it.
_load_env_file(ROOT / ".env")
_load_env_file(V3 / ".env", override=True)


@dataclass(frozen=True)
class Settings:
    """One immutable settings object, imported by routes and services alike."""

    HOST: str
    PORT: int
    TITLE: str
    VERSION: str

    # Locations
    BACKEND: Path
    TEMPLATES: Path
    FRONTEND: Path
    STATIC: Path
    DATA: Path
    #: v2 is only used to load its live bridge modules; v3 reads no data files
    #: from it.
    V2: Path


settings = Settings(
    HOST=os.environ.get("CONSOLE_HOST", "127.0.0.1"),
    PORT=int(os.environ.get("CONSOLE_PORT", "5176")),
    TITLE="F-100 Console (v3)",
    VERSION="v3",
    BACKEND=BACKEND,
    TEMPLATES=BACKEND / "templates",
    FRONTEND=V3 / "frontend",
    STATIC=V3 / "frontend" / "static",
    DATA=V3 / "data",
    V2=ROOT / "v2",
)
