# Changelog

All notable changes to NeledPort are listed here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). Versions below 1.0.0 are early previews.

## [Unreleased]

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

[Unreleased]: https://github.com/NexwestLedgerCoreCompanyLimited/NeledPort/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/NexwestLedgerCoreCompanyLimited/NeledPort/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/NexwestLedgerCoreCompanyLimited/NeledPort/releases/tag/v0.1.0
