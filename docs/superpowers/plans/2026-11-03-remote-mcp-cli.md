# Remote machines, MCP and the CLI package: design and plan

**Goal:** watch and control the game servers on another machine (a Linux VPS or a Windows Server) from the
NeledPort app on any PC, let an AI do the same through MCP, and run NeledPort on a Linux server without a screen
from one `npx` command.

**What the user asked (2026-11-03):** an MCP stdio server; an npx-style package for Linux; enter an IP to see a
server machine's status and also start, stop and so on, with security thought through for them. The remaining
choices were handed to us ("think of the functions that suit the program, then start").

## Design

**One API, three roles.** `src/core/api.ts` maps a method name to a manager call, checks the params and the caller's
role, and returns plain JSON. Every transport goes through it, so a rule holds everywhere.

| Role | Who | Methods |
|---|---|---|
| view | a paired device | machine status (CPU, RAM, disk, uptime), server list (status, game, ports, player count), players, bans |
| control | a paired device, the AI | view + start, stop (saves first), restart, update, backup, kick, ban, unban, console command, console lines |
| owner | this machine only (loopback) | control + games, create, install, remove, devices, remote access settings, activity log |

Never reachable from another machine, whatever the role: create or remove servers, pick a launch program, edit
config files, install mods, Steam sign-in. These write files or run code; a leaked device code can at most stop
game servers. View does not get console lines: some games print their admin password there (ARK's command line).

**Transport: HTTPS over TLS-PSK.** Each paired device has its own 256-bit key; the pairing code
`np1.<deviceId>.<key>` is shown once on the server machine and typed into the viewer. The key is the TLS pre-shared
key (TLS 1.2, `ECDHE-PSK-CHACHA20-POLY1305`): no certificates, the key never crosses the network, a wrong key
fails the handshake, and ECDHE gives forward secrecy. Checked on 2026-11-03 in Node 26 and Electron 44 (BoringSSL),
both as server and client.

- Remote access is off by default; the owner turns it on with a port (default 47800) and an address.
- Devices are listed on the server machine and revoked one by one; keys live in `devices.json` (mode 0600).
- 10 failed handshakes from one address in 10 minutes block it for 15 minutes; at most 32 connections; 64 KB bodies.
- Every call other than view, and every refused handshake, goes to `audit.log` (JSON lines, rotated at 1 MB),
  shown in the app and by `neledport activity`.
- The owner listener is always on, on 127.0.0.1 only, with its own key in `local.json` (0600): the CLI and the MCP
  server use it to drive the NeledPort already running (desktop app or `neledport serve`), which owns the game
  processes.

**CLI (`neledport`, `src/cli/`).** `serve` hosts servers headless (Ctrl+C or SIGTERM saves and stops them);
`list`, `status`, `games`, `create`, `install`, `start`, `stop`, `restart`, `update`, `backup`, `remove`,
`players`, `cmd`, `logs`; `devices add|list|revoke`; `remote on|off`; `activity`; `steam-login <user>` (SteamCMD
asks for the password in the terminal itself); `mcp`. Data lives where the desktop app keeps it, so the CLI and MCP
find a running app too.

**Package.** `npm run build:cli` bundles the CLI with its dependencies into `cli/dist`, copies `games/`, and
`npm pack ./cli` makes `neledport-<version>.tgz`, attached to each GitHub release:
`npx --yes --package https://github.com/<repo>/releases/download/v<version>/neledport-<version>.tgz neledport serve`. Publishing to the
npm registry needs an npm account and is the owner's call. The README gets a systemd unit for running 24/7.

**MCP (`neledport mcp`).** Stdio server built on the official `@modelcontextprotocol/server` 2.4 (negotiates the
protocol versions from 2024-10-07 to 2025-11-25, so current clients work). It talks to the local owner API, or to
another machine with `--machine host:port --code np1...`, limited to the control role. Tools: `machine_status`,
`list_servers`, `server_status`, `list_players`, `list_bans`, `start_server`, `stop_server`, `restart_server`,
`update_server`, `backup_server`, `run_command`, `console_output`, `kick_player`, `ban_player`, `unban_player`,
`list_games`; `create_server` and `install_server` only with `--allow-create` on the same machine.

**Desktop app.** A "Remote" page: this computer (remote access switch and port, devices with add and revoke, the
activity log) and other machines (add by address and code, stored encrypted with safeStorage; their servers with
status, players and the buttons their role allows). Keys never reach the renderer.

**Rejected:** one shared password (cannot revoke one PC, no roles); self-signed certificates (no Node API to make
them, users would click through warnings); a hand-written MCP server (the protocol changed shape in 2026-07-28);
`npx github:` (it would install Electron on the server).

## Tasks

1. API with roles, param checks, machine status and the activity log (`src/core/api.ts`, `audit.ts`), unit tests.
2. Devices and pairing codes (`src/core/devices.ts`), unit tests.
3. TLS-PSK server and client with lockout and limits (`src/core/remote.ts`), tests on 127.0.0.1.
4. CLI and headless host (`src/cli/`), tests for argument parsing; MCP server (`src/cli/mcp.ts`), tested over stdio.
5. Package build (`vite.cli.config.ts`, `cli/package.json`, release workflow), checked with `npx` on the tarball.
6. Desktop app: owner and remote listeners in main, IPC, the Remote page, English and Thai text.
7. End to end: CLI `serve` on a Linux CI runner paired with a client; the app against a running `serve`; docs.
