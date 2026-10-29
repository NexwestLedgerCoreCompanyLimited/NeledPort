# NeledPort — Design & Launch Plan

Date: 2026-10-29 · Status: **draft, awaiting owner approval** · Owner: NexwestLedgerCoreCompanyLimited

## 1. Intent

NeledPort is a free, open-source desktop app (Electron) that lets anyone host a Steam dedicated game
server on their own Windows or Linux machine without touching a terminal: pick a game, click install,
press Start, then watch the console, manage players and bans, and add mods — all in one modern UI.

Why it exists (owner's goals, in priority order):
1. A public portfolio project on the owner's GitHub account that attracts many stars and forks.
2. Qualify for Anthropic's *Claude for Open Source* program (6 months of Claude Max 20x).
3. Show joint authorship: every commit is authored by the owner's GitHub account and co-authored by Claude.

### What the Claude for Open Source program actually measures (verified 2026-10-29)

The official page (claude.com/contact-sales/claude-for-oss) has **no star threshold**. The criteria this
project can realistically meet:
- **Community builders:** one of your repos has **20+ unique external contributors with merged PRs in
  the last 12 months**. ← primary target
- "If you maintain something the ecosystem quietly depends on, apply anyway."

Consequence for the design: stars help discovery, but **external contributors are the real metric**.
The architecture must make a first contribution tiny and safe — hence "one game = one JSON file" (§5).
Contributor counts must be real people; sock-puppet accounts would get the application rejected.

## 2. Goals, non-goals, anti-goals

**Goals (v1.0)**
- Install SteamCMD automatically, then install / update / validate any supported dedicated server.
- Start / stop / restart with graceful shutdown; live console with command input.
- Status: running state, uptime, CPU / RAM, player count.
- Players: list, kick, ban, unban (through each game's own mechanism).
- Mods ("อัดฉีด"): one-click server-side mod loaders, Steam Workshop download/update, RCON/console commands.
- Game catalog: Palworld, Rust, Valheim, Counter-Strike 2 fully supported at launch; ~100+ more Steam
  games with basic support; plus "any App ID" for everything else.
- Modern, dark-first, keyboard-friendly UI in English and Thai.
- Windows (x64) and Linux (x64) builds published on GitHub Releases.

**Non-goals (v1.0)** — revisit after launch
- Managing servers on a remote VPS. (Core logic stays free of Electron imports so a headless agent can
  reuse it later.)
- macOS builds (almost no dedicated servers run on macOS).
- Non-Steam servers (Minecraft Java/Bedrock).
- Scheduler (timed restarts/updates), Discord webhooks, UPnP port forwarding, automatic firewall rules.

**Anti-goals** — a release that does any of these is a failure even if it works
- Client-side injection, cheats, anti-cheat bypass, or DLL injection into game clients.
- Bypassing Steam ownership/login requirements for servers that need them.
- Bundling or redistributing SteamCMD, game files, or Steam branding/logos.
- Telemetry without opt-in; any cloud backend or account system (zero recurring cost).
- Losing a player's world: no update or stop path may skip save/backup.

## 3. Constraints

- **License: MIT.** Same as the two closest projects (LinuxGSM 4.9k★ MIT, WindowsGSM 637★ MIT), lowest
  friction for forks and contributions.
- **SteamCMD** is downloaded on first run from Valve's official URLs; never committed or bundled.
- **Linux:** SteamCMD needs 32-bit libs (`lib32gcc-s1` on Debian/Ubuntu). Detect and show the exact
  install command; do not run `sudo` on the user's behalf.
- **Cost:** GitHub Actions (free for public repos) for CI and releases. Builds ship unsigned at first;
  Windows SmartScreen will warn. Free OSS code signing (e.g. SignPath Foundation) to be applied for
  after launch — *verify current terms before applying*.
- **Third-party data:** seed definitions derived from LinuxGSM (MIT) must keep its copyright notice in
  `THIRD_PARTY_NOTICES.md`.

## 4. Architecture

```
┌──────────────── Renderer (React, sandboxed) ────────────────┐
│ Sidebar · Server views · Add-server wizard · Settings       │
└───────────────▲─────────────── typed IPC (preload) ─────────┘
                │  every payload validated in main
┌───────────────┴──────────────── Main process ───────────────┐
│ core/ (plain Node, no Electron imports, unit-tested)         │
│   steamcmd    download, run, parse progress                  │
│   catalog     load + validate games/*.json                   │
│   servers     spawn/stop child processes, state machine      │
│   logs        stream + rotate log files, parse player events │
│   query       A2S_INFO / A2S_PLAYER (UDP)                    │
│   rcon        Source RCON (TCP), WebRCON (WS), REST adapters │
│   mods        workshop download, mod loader installers       │
│   backup      zip world dir before update / on demand        │
│ app/ (Electron glue: windows, tray, IPC handlers, updater)   │
└──────────────────────────────────────────────────────────────┘
```

Decided by the owner: servers run **on the same machine** as the app.

Builder's calls, already made (change only with a reason):
- Electron + TypeScript + React, built with electron-vite; Tailwind CSS + shadcn/ui components.
- electron-builder for packaging (Windows NSIS installer, Linux AppImage + .deb); electron-updater
  against GitHub Releases.
- State in JSON files under the app's `userData` dir (`servers.json`, `settings.json`). No database and
  no native Node modules — they complicate cross-platform builds.
- Secrets (RCON passwords, REST admin passwords) encrypted with Electron `safeStorage`; generated as
  random strings by default.
- i18next for English + Thai.
- Vitest for `core/`; Playwright's Electron support for one end-to-end smoke test.

### Server lifecycle

`not-installed → installing → stopped → starting → running → stopping → stopped` (+ `updating`, `crashed`).

- Processes are spawned with an argument array, never through a shell, so a server name like
  `"; rm -rf ~"` is just a string.
- **Graceful stop:** send the game's save + shutdown command (RCON/REST/stdin per definition), wait up
  to a configurable timeout (default 60 s), then kill. The UI shows which step it is on.
- **Update** = backup world → graceful stop → `steamcmd +app_update` → start (if it was running).
- **Crash:** non-zero exit while `running` → `crashed`, with the last 200 log lines highlighted.
- **Quitting the app** with servers running asks: stop them all (graceful) or keep running in the tray.
- One port-conflict check before start (UDP/TCP ports from the definition).

## 5. Game catalog — the contribution engine

Each game is one file: `games/<id>.json`, validated by a JSON Schema in CI. Definitions are **data only**
— no scripts, no shell strings — so a community PR cannot run code on users' machines.

```jsonc
{
  "id": "palworld",
  "name": "Palworld",
  "serverAppId": 2394010,          // SteamCMD app ID
  "gameAppId": 1623730,            // for cover art from the Steam CDN
  "anonymous": true,               // false → user must log in to SteamCMD
  "tier": "full",                  // full | basic
  "platforms": {
    "linux":   { "executable": "PalServer.sh", "args": ["-port={port}", "-useperfthreads"] },
    "windows": { "executable": "PalServer.exe", "args": ["-port={port}", "-useperfthreads"] }
  },
  "ports": [{ "name": "game", "default": 8211, "protocol": "udp" }],
  "configFiles": [{ "path": "Pal/Saved/Config/LinuxServer/PalWorldSettings.ini", "format": "ini" }],
  "saveDir": "Pal/Saved/SaveGames",
  "control": { "type": "rest", "save": "save", "shutdown": "shutdown" },
  "players": { "source": "rest" },          // rest | rcon | a2s | log
  "bans":    { "method": "rest" },          // rest | rcon | file
  "logPatterns": { "join": "...regex...", "leave": "...regex..." },
  "workshop": null,
  "modLoaders": []
}
```

`control.type` is one of `rcon | webrcon | rest | stdin | signal`. Values above are illustrative; each launch game's exact paths, ports and commands must be checked
against the game's official server docs while writing its definition.

Tiers:
- **full** — every feature, hand-tested by a maintainer: Palworld, Rust, Valheim, Counter-Strike 2.
- **basic** — install, update, start/stop, console, A2S player count. Seeded from LinuxGSM's ~140
  server configs (keep Steam-based ones; Linux values come from LinuxGSM, Windows values are filled
  in by contributors → steady supply of `good first issue`s).
- **custom** — any SteamCMD App ID: install it, then pick the executable with a file picker and type
  arguments. A "Share this game" button turns the result into a definition and opens GitHub's
  new-file page in the browser with it prefilled, so a user becomes a contributor in two clicks.

Launch-game capability map (to verify per game while building):

| Game | Control / players / bans | Mod loader | Workshop |
|---|---|---|---|
| Palworld | REST API | — (v1) | — |
| Rust | WebRCON | Oxide (uMod) or Carbon | — |
| Valheim | stop by signal (saves on SIGINT); players from log parsing; ban/admin list files | BepInEx (Thunderstore pack) | — |
| Counter-Strike 2 | Source RCON | Metamod:Source + CounterStrikeSharp | maps via workshop ID |

Mod loader installers download from the project's official release URL pinned in the definition and
verify a SHA-256 where the project publishes one. Workshop items use
`steamcmd +workshop_download_item <appId> <itemId>`; definitions declare where items are copied.

## 6. UI

Dark-first, high-contrast "control room" look, light theme available. Layout:

- **Left sidebar:** server list with status dot (green running / amber busy / red crashed / grey
  stopped), player count, and a "+ Add server" button.
- **Add-server wizard:** searchable grid of game cover cards (full-tier games badged) → install folder
  and ports → live SteamCMD progress bar.
- **Server view tabs:**
  - Overview: big Start/Stop/Restart/Update buttons, uptime, CPU/RAM sparklines, players online,
    ports to open in the firewall/router (copy button).
  - Console: virtualised live log with level colouring, search, and a command input (RCON/stdin).
  - Players: online list with kick / ban; ban list with unban.
  - Mods: installed mod loader (one-click install/remove), workshop items (add by ID or URL, update all).
  - Config: form view for common settings plus a raw text editor; backup is taken before saving.
  - Backups: list, create, restore (restore requires the server to be stopped).
- **Command palette** (Ctrl/Cmd+K): jump to a server, start/stop, run a command.
- Accessibility: full keyboard navigation, visible focus, status never shown by colour alone.

## 7. Security

- Electron hardening: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, strict CSP,
  no `remote`, external links open in the system browser only.
- Every IPC handler validates its payload (zod) — the renderer is treated as untrusted.
- Game definitions: schema-validated, data only, paths confined to the server's install directory
  (reject `..` and absolute paths).
- RCON/REST bind to localhost unless the user opts in; default passwords are random.
- Never store a Steam password. Non-anonymous servers run SteamCMD's own login (with Steam Guard) in
  an embedded terminal; SteamCMD caches the session itself.

## 8. Repository setup (designed for stars, forks and contributors)

- Repo: **`NexwestLedgerCoreCompanyLimited/NeledPort`**, public, **pinned** on that profile. This is its
  permanent home (see DECISIONS.md). Never keep two live copies: that splits stars.
- Attribution: commits authored with the personal account's *verified* GitHub email (otherwise they will
  not link to the profile), each ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Files: `LICENSE` (MIT), `README.md` + `README.th.md` (hero GIF, download buttons, auto-generated
  supported-games table, "Add your game in 5 minutes"), `CONTRIBUTING.md` (focused on adding a game),
  `CODE_OF_CONDUCT.md` (Contributor Covenant), `SECURITY.md`, `THIRD_PARTY_NOTICES.md`,
  `DECISIONS.md`, issue templates (bug / game request / broken game), PR template.
- `.gitignore` must exclude the local tool folders already in this directory: `.claude/`,
  `.playwright-mcp/`, `.remember/`, `.zcode/`, `.DS_Store`, plus `node_modules/`, `out/`, `dist/`.
- GitHub settings: description, topics (`steamcmd`, `game-server`, `dedicated-server`,
  `server-manager`, `electron`, `palworld`, `rust`, `valheim`, `cs2`), Discussions on, labels
  `good first issue` / `help wanted` / `game-request` / `game-definition`, social preview image.
- CI (GitHub Actions): typecheck, unit tests, schema-validate `games/*.json` (lint and the README games
  table generator arrive in M1); release workflow builds Windows + Linux on a `v*` tag and attaches binaries.

## 9. Milestones

| # | Milestone | Done when |
|---|---|---|
| M0 | Repo bootstrap | Public repo exists with license, community files, CI green on an empty app shell that opens a window |
| M1 | Core loop | SteamCMD auto-install; Palworld + Valheim install / start / graceful stop / live console / backup-before-update, on Windows and Linux |
| M2 | Players & control | A2S query, Source RCON, WebRCON, Palworld REST; Players + Bans tabs; Rust + CS2 added |
| M3 | Mods | Workshop download/update; BepInEx, Oxide/Carbon, Metamod+CounterStrikeSharp installers; Mods tab |
| M4 | Catalog | Basic-tier games imported from LinuxGSM; custom App ID flow; "Share this game" PR helper; definitions refresh from the repo without an app release |
| M5 | v1.0 launch | Thai/English complete, auto-update, screenshots/GIF, release binaries, launch posts |
| — | Apply | Apply to Claude for Open Source once the repo has 20+ external contributors with merged PRs (or earlier via "apply anyway" if adoption is strong) |

Launch channels (M5): r/selfhosted, game-specific subreddits (server-admin threads for Palworld, Rust,
Valheim, CS2), Thai gaming / server-admin Facebook groups and Discords, Show HN.

## 10. Pre-mortem — most likely ways v1 fails, and the guard

1. **A game update changes an executable or argument and servers stop starting.** Guard: crash view links
   to a prefilled "broken game" issue; definitions are hot-reloadable from the repo without a full app
   release (fetch latest `games/` from the default branch, validated against the schema, cache offline).
2. **Unsigned Windows installer scares users away.** Guard: README explains the SmartScreen prompt;
   apply for free OSS signing right after M5.
3. **World loss on stop/update.** Guard: backup-before-update is not optional; graceful stop is tested
   per full-tier game.
4. **Linux users hit missing 32-bit libs.** Guard: preflight check with the exact command to run.
5. **No graceful stop on Windows for signal-only games (Valheim).** Node cannot send Ctrl+C to a child
   process on Windows. Guard: spike this first in M1; if no clean solution, those games show
   "save in-game before stopping" and back up before every stop.

## 11. Left to the builder

Folder layout inside `src/`, component structure, exact zod/JSON-Schema split, log-viewer
virtualisation approach, colour palette and typography within the dark "control room" direction.
