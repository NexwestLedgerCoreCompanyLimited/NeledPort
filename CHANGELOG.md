# Changelog

All notable changes to NeledPort are listed here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). Versions below 1.0.0 are early previews.

## [Unreleased]

### Fixed

- **Rust:** Players, bans and console commands could fail at random with "WebRCON is not reachable". Rust drops new
  WebRCON connections from an address that opens many in a short time, and NeledPort opened one per command. It now
  keeps one connection per server.
- On Windows, stopping a server that cannot be asked to save (Valheim) no longer says it "did not stop in time":
  closing it at once, after the backup, is the plan there.

### Notes

- The weekly real-server test now also runs Valheim on Windows, Palworld on Linux (REST API, save on stop) and
  Rust on Linux (WebRCON, a real ban and unban, save on stop, Oxide).

## [0.7.0] - 2026-10-30

### Added

- **Backups tab:** every backup with when, why and how big, **Back up now**, and **Restore**. Restoring needs the server
  stopped, and the current world is moved aside, never deleted.
- **Config tab:** change a server's settings after creating it (they apply on the next start; **Save and restart**
  while it runs), and edit the game's own config file for Palworld, Rust and Counter-Strike 2 while the server is
  stopped. The previous file is kept as `.neledport.bak`.
- A short tour GIF and up-to-date screenshots in the README.

### Fixed

- Quitting NeledPort during an install now stops SteamCMD instead of leaving it running in the background.

### Notes

- An empty password box in Config keeps the current password. Removing a password is not possible there yet.

## [0.6.0] - 2026-10-30

### Added

- **Languages:** the whole app, including the quit prompt and file pickers, now speaks English and Thai. It follows your
  system language and can be switched in the sidebar. English stays the main language: anything not yet translated shows
  in English. Adding a language is one JSON file (see CONTRIBUTING).
- **Automatic updates** on Windows and with the AppImage: new versions download in the background, then
  **Restart to update** saves and stops your servers first. The `.deb` still updates by installing the new package.
- **Steam sign-in** for the 8 servers that need an account that owns the game (ARMA 3, DayZ and others). You sign in
  once in SteamCMD's own window; NeledPort stores only the account name, never the password.

### Fixed

- An install whose Steam login had expired could wait forever for a password; it now fails with SteamCMD's message.
- A server that is installing but has not reported progress yet no longer says "Stopped".
- A fresh SteamCMD that fails its first install with "Missing configuration" is now retried once.

### Notes

- Updating from 0.5.0 or older: download 0.6.0 from Releases once. From then on NeledPort updates itself.
- Messages that come from SteamCMD and the game servers stay in English.

## [0.5.0] - 2026-10-30

### Added

- **Mods tab** with one-click server mod loaders:
  - **BepInEx for Valheim**: installed from Thunderstore; on Linux NeledPort sets the loader's environment for you.
    Verified on a real Linux server by the weekly end-to-end test.
  - **Oxide (uMod) for Rust**: latest build from GitHub, and reinstalled automatically after every server update
    (updates overwrite it).
- **Plugin manager**: add plugin files, turn them on and off, delete them.
- **Steam Workshop maps for Counter-Strike 2**: paste a Workshop link and the server loads it.
- Removing a loader deletes its files and, if it replaced game files, restores the originals with SteamCMD.

### Security

- Mod loaders download only over HTTPS from GitHub or Thunderstore (including after redirects), and archives
  that try to write outside the server folder are refused before anything is written.

## [0.4.0] - 2026-10-30

### Added

- **84 games in the catalog** (was 5): ARK, Team Fortress 2, Satisfactory, Conan Exiles, Squad, Garry's Mod,
  Left 4 Dead 2, Unturned and more, imported from LinuxGSM as basic definitions. Full list in `docs/GAMES.md`.
- **Any Steam App ID**: search 380 more Steam dedicated servers by name (or type an App ID), install with SteamCMD,
  then choose the program that starts it once.
- Games without a launcher for your OS (for example Linux-only imports on Windows) can still be installed; you pick
  the program after install.
- **Share with the community**: turns a working custom setup into a game definition and opens a prefilled GitHub
  pull request.
- Catalog filters (All / Full / Basic), cover art for most games, and clear labels for servers that need a Steam
  account (Steam sign-in is coming later).
- `scripts/import-catalog.mjs` regenerates the imported games and `docs/GAMES.md`; credits in `THIRD_PARTY_NOTICES.md`.

## [0.3.0] - 2026-10-30

### Added

- **Players tab**: who is online, kick, ban and unban, plus ban by Steam ID. Bans always go through the
  game's own ban system (REST, RCON or ban file), so they hold when NeledPort is closed.
- **Console commands**: type commands into the console (WebRCON for Rust, RCON for Counter-Strike 2,
  `say`/`save` for Palworld).
- **Update check**: shows the installed build and whether Steam has a newer one.
- **Rust** (full support: WebRCON, players, bans, graceful save and quit), **Counter-Strike 2** (basic),
  **SCUM** (basic, Windows only).
- One generated admin password per server for RCON/WebRCON/REST, always bound to this computer.

### Security

- Ban-list paths in game definitions are checked like every other path, so a definition cannot point
  NeledPort at files outside the server folder.

## [0.2.0] - 2026-10-30

### Added

- Add a Palworld or Valheim server from the catalog; NeledPort downloads SteamCMD from Valve and installs
  the dedicated server with a live progress bar.
- Start, stop and restart servers. Stopping asks the server to save first: Palworld through its REST API
  (with a generated admin password, local only), Valheim with Ctrl+C on Linux.
- Update servers safely: stop and save, back up the world, update with validation, start again.
- Manual world backups, kept 10 deep; the replaced world is kept aside when restoring.
- Live console with search and auto-scroll; server logs are also written to disk.
- Port check before start, crash detection, and a prompt to stop running servers when quitting.
- NeledPort logo in the sidebar and README, and as the Windows and Linux app icon.
- Weekly end-to-end test that installs, runs and stops a real Valheim server on Linux.

### Notes

- Valheim on Windows cannot be asked to save before stopping; NeledPort backs up the world first.
- Players, bans, RCON and mods arrive in the next releases.

## [0.1.0] - 2026-10-29

### Added

- Electron app shell with a dark "control room" UI and a game catalog view.
- Game definitions as data-only JSON files in `games/`, validated by `games/schema.json`
  (unsafe paths, bad JSON and id/filename mismatches are rejected without crashing the app).
- Palworld definition (full tier, in progress).
- CI on Linux and Windows (typecheck, tests, build) and a tag-driven release workflow.
- Community files: MIT license, contributing guide, code of conduct, security policy.

[Unreleased]: https://github.com/NexwestLedgerCoreCompanyLimited/NeledPort/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/NexwestLedgerCoreCompanyLimited/NeledPort/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/NexwestLedgerCoreCompanyLimited/NeledPort/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/NexwestLedgerCoreCompanyLimited/NeledPort/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/NexwestLedgerCoreCompanyLimited/NeledPort/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/NexwestLedgerCoreCompanyLimited/NeledPort/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/NexwestLedgerCoreCompanyLimited/NeledPort/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/NexwestLedgerCoreCompanyLimited/NeledPort/releases/tag/v0.1.0
