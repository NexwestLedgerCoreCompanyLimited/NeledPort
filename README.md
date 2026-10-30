<div align="center">

<img src="docs/images/logo.png" alt="NeledPort logo" width="200" />

# NeledPort

**Host Steam dedicated game servers from one modern desktop app.**
Install, run, watch, moderate and mod your server: no terminal required.

[![CI](https://github.com/NexwestLedgerCoreCompanyLimited/NeledPort/actions/workflows/ci.yml/badge.svg)](https://github.com/NexwestLedgerCoreCompanyLimited/NeledPort/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/NexwestLedgerCoreCompanyLimited/NeledPort?include_prereleases&sort=semver)](https://github.com/NexwestLedgerCoreCompanyLimited/NeledPort/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Status](https://img.shields.io/badge/status-early%20development-orange)

English · [ภาษาไทย](README.th.md)

<img src="docs/images/tour.gif" alt="A tour of NeledPort: game catalog, add a server, server overview, console, players, mods, config and backups" width="800" />

</div>

> NeledPort is in early development. Star the repo to follow along, or [add your favourite game](CONTRIBUTING.md#add-a-game) to the catalog.

## Why

Running a dedicated server today means SteamCMD commands, hand-edited config files and a terminal you can't close.
NeledPort wraps all of that in a desktop app for Windows and Linux.

## Features

- **One-click install.** NeledPort downloads SteamCMD for you, then installs, updates and validates servers.
- **Start, stop, restart** with graceful shutdown, so worlds are saved first.
- **Live console** with search and a command box (RCON / stdin).
- **Players and bans:** kick, ban and unban through each game's own mechanism.
- **Mods:** one-click server-side mod loaders (BepInEx for Valheim, Oxide for Rust, SourceMod for 23 Source games, AMX
  Mod X for 8 Half-Life games), a plugin
  manager, and Steam Workshop maps for CS2.
- **Config:** change a server's settings after creating it, and edit the game's own config file (Palworld, Rust, CS2).
  The previous file is kept.
- **Backups:** made automatically before every update, or with **Back up now**. Restore one in a click; the current
  world is moved aside, never deleted.
- **Speaks your language:** English and Thai today, and [adding yours](CONTRIBUTING.md#translate-neledport) is one file.

Planned: uptime and CPU/RAM graphs, a command palette, a light theme.

<details>
<summary>Screenshots (sample servers)</summary>

| | |
|---|---|
| ![Game catalog](docs/images/screens/catalog.png) | ![Add a server](docs/images/screens/add-server.png) |
| ![Server overview](docs/images/screens/overview.png) | ![Live console](docs/images/screens/console.png) |
| ![Players and bans](docs/images/screens/players.png) | ![Mods](docs/images/screens/mods.png) |
| ![Config](docs/images/screens/config.png) | ![Backups](docs/images/screens/backups.png) |

</details>

## Download

Get the latest installer for Windows (`.exe`) or Linux (`.AppImage`, `.deb`) from
[Releases](https://github.com/NexwestLedgerCoreCompanyLimited/NeledPort/releases). What changed in each version is in the
[changelog](CHANGELOG.md).

NeledPort updates itself on Windows and with the AppImage: when a new version is ready, press **Restart to update**.
With the `.deb`, install the new `.deb` from Releases.

> Builds are not code-signed yet, so Windows SmartScreen may warn on first launch: choose **More info → Run anyway**.

## Supported games

| Game | Support | Status |
|---|---|---|
| Palworld | full | install, run, update, players, kick/ban, console, settings file; tested on a real Linux server weekly |
| Valheim | full | install, run, update, players, bans, BepInEx mods; tested on real Linux and Windows servers weekly |
| Rust | full | install, run, update, players, kick/ban, WebRCON console, Oxide plugins, server.cfg; tested on a real Linux server weekly |
| Counter-Strike 2 | basic | install, run, RCON console, players, kick, Workshop maps, server.cfg |
| SCUM | basic | install, run, players (Windows only) |
| Team Fortress 2, Counter-Strike: Source, Garry's Mod, Left 4 Dead 2, Insurgency and 20 more Source games | full | install, run, update, players, kick/ban, RCON console, SourceMod (23 of them); TF2 and CS:S tested on real Linux servers weekly |
| Counter-Strike 1.6, Day of Defeat, Team Fortress Classic, Half-Life Deathmatch and 5 more GoldSrc games | full | install, run, update, players, kick/ban, RCON console, AMX Mod X (8 of them); CS 1.6 and DoD tested on real Linux servers weekly |
| ARK, Satisfactory, Conan Exiles, Squad, DayZ and 31 more | basic | install, run, console ([full list](docs/GAMES.md)) |
| ARMA 3, DayZ and 6 more that need a Steam account | basic | sign in once in SteamCMD's own window; NeledPort never sees your password |
| **Any Steam App ID** | custom | search 380+ more servers by name, install, pick the program once, share it |

Every game is a single JSON file in [`games/`](games). Missing yours? Install it with **Any Steam App ID**, press
**Share with the community**, and NeledPort opens a ready-made pull request for you. Or [add it by hand](CONTRIBUTING.md#add-a-game).

## Development

Requirements: Node.js 24+ and npm.

```bash
npm install
npm run dev        # start the app with hot reload
npm test           # unit tests, including validation of every games/*.json
npm run typecheck
npm run build      # production bundle
npm run dist       # installers for the current OS
```

## Project docs

- [Design and roadmap](docs/superpowers/specs/2026-10-29-neledport-design.md)
- [Contributing](CONTRIBUTING.md) · [Code of conduct](CODE_OF_CONDUCT.md) · [Security](SECURITY.md) · [Decisions](DECISIONS.md)

## Legal

NeledPort is not affiliated with Valve or any game publisher. It downloads SteamCMD and server files from Valve at runtime and never redistributes them.
Each game server is subject to its own licence.

Licensed under the [MIT License](LICENSE).
