# Decisions

Significant choices, why we made them, and what we turned down. Newest first.

## 2026-10-30 · Config files edited as plain text, only while the server is stopped

- **Decision:** the Config tab edits the server's settings from its game definition as a form, and the game's own
  config files (`configFiles` in the definition) as plain text. Text files can be saved only while the server is
  stopped; the previous version is kept as `<file>.neledport.bak`. Restoring a backup moves the current world aside
  instead of deleting it.
- **Why:** some games rewrite their config when they exit, which would silently undo an edit made while running.
  Plain text works for every format without one parser per game.
- **Rejected:** per-game forms parsed from each config format (one parser per game; contributors can add form
  fields to a definition's `settings` instead).

## 2026-10-30 · Steam sign-in in SteamCMD's own window

- **Decision:** for the few servers that need an account, NeledPort stores only the account name and opens SteamCMD
  (`+login <name>`) in a terminal window, where the user types the password and Steam Guard code. SteamCMD keeps the
  session; installs then run `+login <name>`. "Check" runs a login with no input and reads "Waiting for user info...OK".
  SteamCMD always runs with its input closed, so an expired session fails the install instead of hanging it.
- **Why:** NeledPort never sees or stores the password, and SteamCMD handles every Steam Guard variant itself.
- **Rejected:** an embedded terminal as the design first said (needs node-pty, a native module rebuilt for every Electron
  version); a password field that feeds SteamCMD (NeledPort would hold the password and parse prompts that differ
  between Windows and Linux).

## 2026-10-30 · App updates with electron-updater, pre-releases while on 0.x

- **Decision:** electron-updater downloads new GitHub Releases in the background on Windows (NSIS) and AppImage, then
  offers "Restart to update", which saves and stops running servers first. `allowPrerelease` is on only while the app
  is 0.x, because every 0.x release is marked pre-release and the stable-only lookup (`/releases/latest`) finds none.
- **Why:** It reads the `latest*.yml` files the release workflow already publishes and checks each download's sha512.
  Checked against the real v0.5.0 release: stable-only fails ("ensure a production release exists"); with
  pre-releases it finds 0.5.0 and the download passes the checksum.
- **Rejected:** writing our own updater (download verification and installer hand-off are easy to get wrong);
  updating `.deb` installs (needs root through pkexec; those users update like any other package).

## 2026-10-30 · Translations as JSON in src/core, English as fallback

- **Decision:** one flat JSON file per language in `src/core/locales/`, read by both the window and the main process.
  English is complete; other languages may be partial and fall back to English per string.
- **Why:** translators edit one file without touching code, and a half-finished language can still ship.
- **Rejected:** i18next or react-intl (a dependency for ~200 strings with no plurals); separate files for the main
  process (the quit prompt would drift from the window's language).

## 2026-10-29 · Repository lives on the personal account

- **Decision:** `NexwestLedgerCoreCompanyLimited/NeledPort` is the one permanent home of the project.
- **Why:** The `NEXWEST-LEDGER-CORE` org was hidden from the public (its pages return 404 when signed out),
  Actions never started there, and GitHub refused a repository transfer from it. The org is being retired.
- **Rejected:** keeping copies in two places (stars and updates would split).

## 2026-10-29 · Versioning and releases

- **Decision:** SemVer driven by `npm version`; pushing a `vX.Y.Z` tag runs a workflow that builds installers
  and creates the GitHub Release. electron-builder's `publish: github` config writes `latest*.yml`, so the
  in-app auto-updater (electron-updater, planned for M5) can read the same releases.
- **Why:** One command to ship, and the tag/version check stops mismatched releases.
- **Rejected:** electron-builder publishing directly from each OS job (two parallel jobs can race to create
  the same release); release-please (more moving parts than a small project needs today).

## 2026-10-29 · M0 tooling: no ESLint or Playwright yet

- **Decision:** CI runs typecheck, unit tests (which also validate `games/*.json`) and a production build.
- **Why:** Small surface at M0; strict TypeScript covers most of what lint would catch.
- **Later:** ESLint and one Playwright Electron smoke test arrive in M1.

## 2026-10-29 · Game definitions validated by one JSON Schema (Ajv)

- **Decision:** `games/schema.json` is the single source of truth, used by tests, by the app at runtime,
  and by contributors' editors for autocomplete.
- **Rejected:** zod-only types (no editor autocomplete in JSON files); per-game TypeScript modules (would let
  a pull request run code on users' machines).

## 2026-10-29 · State in JSON files, no database

- **Decision:** Servers and settings live in JSON files under Electron's `userData` folder.
- **Rejected:** SQLite, because native Node modules complicate cross-platform Electron builds and the data is tiny.

## 2026-10-29 · Electron + React + TypeScript + Tailwind

- **Decision:** electron-vite, React 19, Tailwind CSS 4, TypeScript.
- **Why:** The most widely known stack, so the most potential contributors; one codebase for Windows and Linux.
- **Rejected:** Tauri (smaller binaries, but Rust narrows the contributor pool); a web panel (needs a server and auth).

## 2026-10-29 · MIT License

- **Decision:** MIT.
- **Why:** Lowest friction for forks and contributions; matches LinuxGSM and WindowsGSM.
- **Rejected:** GPL-3.0 (stops closed-source forks but deters some contributors and companies).
