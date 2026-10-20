# F-100 Retro Truck Console

**A multi-simulator command deck for your driving rig.** F-100 brings truck dashboards, map navigation, route history, controls, Spotify, and companion simulator screens together in a retro-inspired local console.

<p align="center">
  <img src="screenshots/f100-command-deck.jpg" alt="F-100 Console launcher with ATS, ETS2, Bus Simulator, Construction Simulator, RoadCraft, SnowRunner, and Settings apps" width="100%">
 </p>

*The launcher preview: seven focused apps, live bridge status, and a shared command-deck interface. The screenshot was captured locally with no simulator connected.*

## What it does

- **American Truck Simulator:** dashboard and an interactive, locally generated map; live telemetry and controls when the SCS plugin is available.
- **Euro Truck Simulator 2:** dashboard and shared SCS integration; European map data is not yet parsed.
- **Bus Simulator 21:** service and cockpit screens backed by the optional `bussim_link` bridge.
- **Construction Simulator:** machine and company screens; telemetry integration is not available yet.
- ***RoadCraft and SnowRunner:** dedicated truck/terrain and rig/haul screens, with game-specific telemetry integration still in development.
- **Settings:** appearance, units, interface, and diagnostics.
- **Drive head unit:** map, Spotify, truck controls, and keybind layouts in a deep-linkable shell.

The console is designed to show when a game, bridge, or data bundle is unavailable rather than inventing telemetry or implying a control worked.

## Current status

F-100 is a local companion display, not a game modification or online-game cheat. It runs as a Flask web app and reads simulator data through local integrations. The preview confirms the launcher and app status uI render; it does **not** indicate that a simulator is connected or that game controls have been verified live.

- ATS map data is generated locally from the player's own game installation; generated map files and proprietary game assets do not belong in this repository.
- ETSSECB1