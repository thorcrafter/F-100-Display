"""Session trip meter — dead reckoning from the SCS position readback.

This replaces the map.  The deck draws no world file, so the only position it
can honestly know is the one the game publishes: `x` / `y` in world metres.
Integrating consecutive positions gives a distance for this session; that is a
*trace*, not a map, and the screen says so.

Two rules keep the numbers honest:

* **A jump is not a drive.**  If the next point is too far away to have been
  reached at the reported speed, the game teleported the truck (garage, ferry,
  reload).  The meter starts a new segment instead of inventing hundreds of
  kilometres of road.
* **Closed game, stopped clock.**  Samples only count while the game is
  connected and active.  Wall time still runs, but it is reported separately as
  `elapsed_s`; average speed divides by `driving_s`.

Distance is reported in world metres and in game kilometres.  The map's scale
is 1:19 (`v2/backend/services/route_planner.py` uses the same constant for the
game odometer), so game km = world metres × 19 / 1000.
"""
from __future__ import annotations

import math
import threading
import time
from datetime import datetime, timezone

#: The map's scale.  Speed numerics are world speed; the game odometer shows
#: world distance × 19, which is what a driver expects to read on a trip meter.
GAME_SCALE = 19.0
#: Longest gap between samples that still counts as driving.  A hidden tab or a
#: stalled poll must not turn one packet into a straight line across the state.
MAX_DT_S = 10.0
#: World metres between trace points.  Below this the trace would be a blob.
TRACE_MIN_STEP_M = 5.0
#: Points kept for the drawing.  At 1 Hz and 5 m steps this is minutes of road.
TRACE_POINTS = 320
#: Speed under which the truck is not credited with driving time.
MOVING_KMH = 2.0


class TripMeter:
    """Thread-safe, monotonic-clock trip accumulator."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._resets = 0
        self._clear()

    # ---------------------------------------------------------- internals

    def _clear(self) -> None:
        self._started: datetime | None = None
        self._started_mono: float | None = None
        self._last_mono: float | None = None
        self._last_xy: tuple[float, float] | None = None
        self._active = False
        self._samples = 0
        self._segments = 1
        self._world_m = 0.0
        self._driving_s = 0.0
        self._max_kmh: float | None = None
        self._fuel_start: float | None = None
        self._fuel_low: float | None = None
        self._trace: list[list[float]] = []

    # ------------------------------------------------------------ writes

    def reset(self) -> dict:
        """Start a new trip.  The deck's Reset button calls this."""
        with self._lock:
            self._resets += 1
            self._clear()
            return self._snapshot_locked()

    def sample(self, truck: dict, connected: bool, active: bool,
               now: float | None = None) -> None:
        """Fold one telemetry snapshot into the meter.

        Called from `/api/telemetry/`, so the deck's own 1 Hz poll is the
        sampling clock — no background thread, no second reader of shared
        memory.  `now` is injectable so the arithmetic can be tested without
        sleeping.
        """
        now = time.monotonic() if now is None else now
        if not (connected and active):
            with self._lock:
                self._active = False
                # Break the line: the next point after the game comes back is
                # not connected to this one.
                self._last_mono = None
                self._last_xy = None
            return

        x = _reading(truck.get("x"))
        y = _reading(truck.get("y"))
        speed = _reading(truck.get("speedKmh"))
        fuel = _reading(truck.get("fuel"))

        with self._lock:
            if self._started is None:
                self._started = datetime.now(timezone.utc)
                self._started_mono = now
            self._active = True
            self._samples += 1

            if speed is not None:
                self._max_kmh = speed if self._max_kmh is None else max(self._max_kmh, speed)

            if fuel is not None:
                if self._fuel_start is None:
                    self._fuel_start = fuel
                self._fuel_low = fuel if self._fuel_low is None else min(self._fuel_low, fuel)

            dt = None if self._last_mono is None else now - self._last_mono
            if dt is not None and 0 < dt <= MAX_DT_S:
                if speed is not None and speed > MOVING_KMH:
                    self._driving_s += dt

            if x is not None and y is not None:
                point = (x, y)
                previous = self._last_xy
                if previous is not None and dt is not None and 0 < dt <= MAX_DT_S:
                    step = math.hypot(x - previous[0], y - previous[1])
                    # Three times the distance the reported speed could cover,
                    # plus a generous floor for one-second sample jitter.
                    allowed = max(400.0, (speed or 0.0) / 3.6 * dt * 3.0 + 50.0)
                    if step > allowed:
                        self._segments += 1
                        self._trace.clear()
                    elif step > 0:
                        self._world_m += step
                if not self._trace:
                    self._trace.append([round(x, 1), round(y, 1)])
                else:
                    last = self._trace[-1]
                    if math.hypot(x - last[0], y - last[1]) >= TRACE_MIN_STEP_M:
                        self._trace.append([round(x, 1), round(y, 1)])
                        if len(self._trace) > TRACE_POINTS:
                            del self._trace[0]
                self._last_xy = point

            self._last_mono = now

    # ------------------------------------------------------------- reads

    def snapshot(self) -> dict:
        with self._lock:
            return self._snapshot_locked()

    def _snapshot_locked(self) -> dict:
        now = time.monotonic()
        elapsed = int(now - self._started_mono) if self._started_mono is not None else 0
        world_m = self._world_m
        km = world_m * GAME_SCALE / 1000.0
        hours = self._driving_s / 3600.0
        # Average is world speed (what the speedometer reads): both the game
        # distance and the game clock run at ×19, so the ratio is unchanged.
        world_km = world_m / 1000.0
        used = None
        economy = None
        if self._fuel_start is not None and self._fuel_low is not None:
            used = max(0.0, self._fuel_start - self._fuel_low)
            if km > 0.5:
                economy = used / km * 100.0
        return {
            # Set by the sample, cleared when the game stops reporting.  The
            # deck's poll is the clock, so a stale flag cannot outlive it.
            "active": bool(self._active),
            "started": self._started.isoformat(timespec="seconds") if self._started else None,
            "elapsed_s": elapsed,
            "driving_s": int(self._driving_s),
            "distance_m": round(world_m, 1),
            "distance_km": round(km, 2),
            "game_scale": GAME_SCALE,
            "avg_kmh": round(world_km / hours, 1) if hours > 0 else None,
            "max_kmh": None if self._max_kmh is None else round(self._max_kmh, 1),
            "fuel_used_l": None if used is None else round(used, 1),
            "economy_l_100km": None if economy is None else round(economy, 1),
            "samples": self._samples,
            "segments": self._segments,
            "resets": self._resets,
            "trace": [list(point) for point in self._trace],
            "note": "dead reckoning from the position readback; no map data",
        }


def _reading(value) -> float | None:
    """A float for a published number, else None.  Never zero-fill."""
    if value is None or isinstance(value, bool):
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


trip_meter = TripMeter()
