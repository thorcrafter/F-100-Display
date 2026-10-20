# F-100 Retro Truck Console

**A multi-simulator command deck for your driving rig.** F-100 brings truck dashboards, map navigation, route history, controls, Spotify, and companion simulator screens together in a retro-inspired local console.



*The launcher preview: seven focused apps, live bridge status, and a shared command-deck interface. The screenshot was captured locally with no simulator connected.*

## What it does

- **American Truck Simulator:** dashboard and an interactive, locally generated map; live telemetry and controls when the SCS plugin is available.
- **Euro Truck Simulator 2:** dashboard and shared SCS integration; European map data is not yet parsed.
- **Bus Simulator 21:** service and cockpit screens backed by the optional `bussim_link` bridge.
- **Construction Simulator:** machine and company screens; telemetry integration is not available yet.
- **RoadCraft and SnowRunner:** dedicated truck/terrain and rig/haul screens, with game-specific telemetry integration still in development.
- **Settings:** appearance, units, interface, and diagnostics.
- **Drive head unit:** map, Spotify, truck controls, and keybind layouts in a deep-linkable shell.

The console is designed to show when a game, bridge, or data bundle is unavailable rather than inventing telemetry or implying a control worked.

## Current status

F-100 is a local companion display, not a game modification or online-game cheat. It runs as a Flask web app and reads simulator data through local integrations. The preview confirms the launcher and app status UI render; it does **not** indicate that a simulator is connected or that game controls have been verified live.

- ATS map data is generated locally from the player's own game installation; generated map files and proprietary game assets do not belong in this repository.
- ETS2 Europe map parsing is not implemented yet.
- Bus Simulator 21 controls use the game's configured keys. Their in-game effect needs a live session to verify.
- Construction Simulator has no telemetry bridge yet. RoadCraft and SnowRunner integrations are still being developed.
- Spotify desktop mirroring and controller enumeration are Windows-first; Spotify Web API features require the user's own configuration.

## Source and setup

This GitHub repository currently contains the project landing page and preview image; **the application source and runtime files are not included here yet**, so cloning this repository alone will not run the console. The working application uses Python 3.14 and Flask and is served locally at `http://127.0.0.1:5178/`. Once the source tree is published here, setup instructions will be added alongside it.

## Project links

- [F-100-Display on GitHub](https://github.com/thorcrafter/F-100-Display)
- [Preview screenshot](screenshots/f100-command-deck.jpg)
