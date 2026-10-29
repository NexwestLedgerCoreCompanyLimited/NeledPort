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

<img src="docs/images/screenshot.png" alt="NeledPort game catalog" width="800" />

</div>

> NeledPort is in early development. Star the repo to follow along, or [add your favourite game](CONTRIBUTING.md#add-a-game) to the catalog.

## Why

Running a dedicated server today means SteamCMD commands, hand-edited config files and a terminal you can't close.
NeledPort wraps all of that in a desktop app for Windows and Linux.

## Features (planned for v1.0)

- **One-click install.** NeledPort downloads SteamCMD for you, then installs, updates and validates servers.
- **Start, stop, restart** with graceful shutdown, so worlds are saved first.
- **Live console** with search and a command box (RCON / stdin).
- **Status:** uptime, CPU, RAM and players online.
- **Players and bans:** kick, ban and unban through each game's own mechanism.
- **Mods:** one-click server-side mod loaders (BepInEx, Oxide/Carbon, Metamod + CounterStrikeSharp) and Steam Workshop downloads.
- **Automatic backups** before every update.
- **English and Thai UI**, dark-first and keyboard-friendly.

## Download

Get the latest installer for Windows (`.exe`) or Linux (`.AppImage`, `.deb`) from
[Releases](https://github.com/NexwestLedgerCoreCompanyLimited/NeledPort/releases). What changed in each version is in the
[changelog](CHANGELOG.md).

> Builds are not code-signed yet, so Windows SmartScreen may warn on first launch: choose **More info → Run anyway**.

## Supported games

| Game | Support | Status |
|---|---|---|
| Palworld | full | install, run, update, players, kick/ban, console |
| Valheim | full | install, run, update, players, bans; tested on real Linux servers weekly |
| Rust | full | install, run, update, players, kick/ban, WebRCON console |
| Counter-Strike 2 | basic | install, run, RCON console, players, kick |
| SCUM | basic | install, run, players (Windows only) |
| ARK, Team Fortress 2, Satisfactory, Conan Exiles, Squad and 70+ more | basic | install, run, console ([full list](docs/GAMES.md)) |
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
