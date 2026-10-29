<div align="center">

# NeledPort

**Host Steam dedicated game servers from one modern desktop app.**
Install, run, watch, moderate and mod your server: no terminal required.

[![CI](https://github.com/NEXWEST-LEDGER-CORE/NeledPort/actions/workflows/ci.yml/badge.svg)](https://github.com/NEXWEST-LEDGER-CORE/NeledPort/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Status](https://img.shields.io/badge/status-early%20development-orange)

English · [ภาษาไทย](README.th.md)

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

## Supported games

| Game | Support | Status |
|---|---|---|
| Palworld | full | in progress |
| Rust | full | planned |
| Valheim | full | planned |
| Counter-Strike 2 | full | planned |
| 100+ more Steam dedicated servers | basic | planned |
| Any SteamCMD App ID | custom | planned |

Every game is a single JSON file in [`games/`](games). Missing yours? [Add it](CONTRIBUTING.md#add-a-game) in about five minutes.

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
