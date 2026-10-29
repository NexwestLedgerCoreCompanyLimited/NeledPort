# M2 Players, Bans and Remote Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** See who is online, kick, ban and unban, send console commands, and know whether a server build is out of date — for Palworld, Valheim, Rust, Counter-Strike 2 and SCUM.

**Spec:** `docs/superpowers/specs/2026-10-29-neledport-design.md` (M2, §5 capability map).

## Global Constraints

- Node built-ins only: TCP (`net`), UDP (`dgram`), WebSocket is Node's global client.
- Every remote-control port binds to / talks to 127.0.0.1; passwords are generated (`{adminPassword}` placeholder, one per server).
- Bans always use the game's own mechanism, so they hold when NeledPort is closed.
- Every network call has a timeout (5 s) and a clear error.

## Review Focus

1. Server not ready yet (RCON refused) → players list shows "not reachable yet", no crash.
2. Command output split over several RCON packets → collected in full.
3. Player names with quotes or spaces in kick/ban commands → quoted, never break the command.
4. A ban file that does not exist yet → empty list; banning creates it.
5. Build check while offline → "could not check", not "up to date".

---

### Task 1: Protocol clients
`core/rcon.ts` `sourceRcon({ port, password })` → `{ exec(cmd): Promise<string>, close() }` (auth, multi-packet via empty-packet terminator).
`core/webrcon.ts` `webRcon({ port, password })` → `{ exec(cmd): Promise<string>, close() }` (JSON `{Identifier, Message, Name}`).
`core/a2s.ts` `queryPlayers(port)` → `{ name, score, seconds }[]` (challenge handshake).
Tests against local fake servers (minimal WebSocket server written in the test).

### Task 2: Build check
`core/build.ts` `installedBuild(installDir, appId)` from `steamapps/appmanifest_<id>.acf`; `parseLatestBuild(appInfoText)` from `app_info_print` (`branches → public → buildid`). Manager `checkBuild(id)` → `{ installed?, latest?, updateAvailable, error? }`.

### Task 3: Admin adapters and manager API
`core/admin.ts` `adminFor(game, server, ctx)` → `{ players(), kick?, ban?, unban?, bans?, command? }` for `rest` (Palworld REST + `Pal/Saved/SaveGames/banlist.txt`), `webrcon` (Rust `playerlist`, `kick`, `banid`, `unban`, `cfg/bans.cfg`), `rcon` (Source RCON + A2S players, `kick`), `log`/`file` (Valheim connection lines + `bannedlist.txt`), `a2s` (players only).
Manager: `players`, `kick`, `ban`, `unban`, `bans`, `command` (echoed to the console), Linux `~/.steam/sdk64/steamclient.so` provisioning before start.

### Task 4: Definitions
`{adminPassword}` placeholder. Rust (full), Counter-Strike 2 (basic: needs a real-server check), SCUM (basic, Windows only).

### Task 5: UI
Players tab (online list with Kick/Ban, ban list with Unban, refresh every 10 s), console command box when the game supports commands, build line + "Check for updates" on Overview.
