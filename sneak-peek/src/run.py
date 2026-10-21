"""v3 entry point.

    .venv/Scripts/python.exe v3/run.py       # http://127.0.0.1:5176

Runs alongside v1 (5173), the map render test (5174), v2 (5178) and the ATS
mirror feed (5179).  v3 reads no map bundle: it reuses v2's live bridges only.
"""
from __future__ import annotations

import sys
from pathlib import Path

# Allow `python v3/run.py` from the checkout root as well as from v3/.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from backend.app import create_app  # noqa: E402
from backend.config import settings  # noqa: E402
from backend.registry import APPS  # noqa: E402


def main() -> None:
    application = create_app()
    print(f"F-100 Console v3 · http://{settings.HOST}:{settings.PORT}/")
    for record in APPS:
        tabs = " · ".join(screen.label.lower() for screen in record.screens)
        print(f"  {record.short:<6} {record.units:<8} {record.href()}  [{tabs}]")
    print("  map data     none · Trip dead-reckons from the position readback")
    application.run(host=settings.HOST, port=settings.PORT, debug=False, threaded=True)


if __name__ == "__main__":
    main()
