"""The v3 registry — apps and the MFD screens they expose.

v2's grammar was app → section → screen.  v3 has one physical deck, and the MFD
tab rail *is* its navigation, so the middle level is gone: an app owns the
screens the rail shows.

    app  →  screen          /ats/media/, /ats/nav/, /ets/vehicle/ …

Keeping the registry as data (rather than hand-pasted tab markup) is the part
of v2 that matters: the router, the MFD rail, the boot payload and
`/api/apps/` all read the same records, so a new screen cannot exist in one
place and be missing in another.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Screen:
    """One MFD view: exactly one URL and one fragment template."""

    id: str
    label: str
    icon: str
    template: str
    blurb: str = ""
    #: Keyboard hint shown in the tab tooltip.
    hint: str = ""


@dataclass(frozen=True)
class ConsoleApp:
    """A simulator the deck can be pointed at."""

    id: str
    name: str
    short: str
    theme: str
    accent: str
    icon: str
    units: str
    provider: str | None
    screens: tuple[Screen, ...]
    note: str = ""

    def screen(self, screen_id: str) -> Screen | None:
        for screen in self.screens:
            if screen.id == screen_id:
                return screen
        return None

    @property
    def default_screen(self) -> Screen | None:
        return self.screens[0] if self.screens else None

    def href(self, screen: Screen | None = None) -> str:
        target = screen or self.default_screen
        return f"/{self.id}/{target.id}/" if target else f"/{self.id}/"


#: The MFD rail, in physical order.  Media first, because that is where the
#: deck rests when nothing else is happening.
_MFD_SCREENS: tuple[Screen, ...] = (
    Screen("media", "Media", "play", "mfd/media.html",
           "Now playing, transport and the media source", hint="1"),
    Screen("climate", "Climate", "climate", "mfd/climate.html",
           "Cab climate — waiting for a bridge", hint="2"),
    Screen("trip", "Trip", "compass", "mfd/trip.html",
           "Dead-reckoned distance, compass and session trace", hint="3"),
    Screen("vehicle", "Vehicle", "truck", "mfd/vehicle.html",
           "Engine, fluids and drivetrain, read from the game", hint="4"),
    Screen("phone", "Phone", "phone", "mfd/phone.html",
           "Hands-free calling and the companion handset", hint="5"),
    Screen("setup", "Setup", "gear", "mfd/setup.html",
           "Units, bridge diagnostics and firmware", hint="6"),
)

APPS: tuple[ConsoleApp, ...] = (
    ConsoleApp(
        id="ats",
        name="American Truck Simulator",
        short="ATS",
        theme="retro",
        accent="#e2a03c",
        icon="ats",
        units="imperial",
        provider="ats",
        screens=_MFD_SCREENS,
        note="SCS bridge · telemetry only",
    ),
    ConsoleApp(
        id="ets",
        name="Euro Truck Simulator 2",
        short="ETS2",
        theme="modern",
        accent="#4ea3e0",
        icon="ets",
        units="metric",
        provider="ets",
        screens=_MFD_SCREENS,
        note="SCS bridge · telemetry only",
    ),
)

_BY_ID = {app.id: app for app in APPS}


def get_app(app_id: str) -> ConsoleApp | None:
    return _BY_ID.get(app_id)


def apps_payload() -> list[dict]:
    """JSON view of the registry for `/api/apps/`."""
    return [
        {
            "id": app.id,
            "name": app.name,
            "short": app.short,
            "theme": app.theme,
            "accent": app.accent,
            "icon": app.icon,
            "units": app.units,
            "provider": app.provider,
            "note": app.note,
            "href": app.href(),
            "screens": [
                {
                    "id": screen.id,
                    "label": screen.label,
                    "icon": screen.icon,
                    "blurb": screen.blurb,
                    "hint": screen.hint,
                    "href": app.href(screen),
                }
                for screen in app.screens
            ],
        }
        for app in APPS
    ]
