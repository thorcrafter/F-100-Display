"""Small JSON helpers shared by the v3 routes.

The deck's rule is that a value the bridge did not publish is `null`, never a
zero standing in for "not read".  These helpers keep that rule in one place.
"""
from __future__ import annotations


def number(value):
    """Return a float for a real reading, else None."""
    if value is None or isinstance(value, bool):
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result


def integer(value):
    reading = number(value)
    return None if reading is None else int(round(reading))


def boolean(value):
    """A tri-state boolean: True, False, or None when it was not published."""
    if value is None:
        return None
    return bool(value)
