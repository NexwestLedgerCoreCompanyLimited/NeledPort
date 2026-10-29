# Changelog

All notable changes to NeledPort are listed here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). Versions below 1.0.0 are early previews.

## [Unreleased]

## [0.1.0] - 2026-10-29

### Added

- Electron app shell with a dark "control room" UI and a game catalog view.
- Game definitions as data-only JSON files in `games/`, validated by `games/schema.json`
  (unsafe paths, bad JSON and id/filename mismatches are rejected without crashing the app).
- Palworld definition (full tier, in progress).
- CI on Linux and Windows (typecheck, tests, build) and a tag-driven release workflow.
- Community files: MIT license, contributing guide, code of conduct, security policy.

[Unreleased]: https://github.com/NexwestLedgerCoreCompanyLimited/NeledPort/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/NexwestLedgerCoreCompanyLimited/NeledPort/releases/tag/v0.1.0
