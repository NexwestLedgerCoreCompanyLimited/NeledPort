# Decisions

Significant choices, why we made them, and what we turned down. Newest first.

## 2026-11-03 · Remote machines, CLI and MCP share one API, keyed by TLS pre-shared keys

- **Decision:** one API (`src/core/api.ts`) with three roles (view, control, owner) serves the app's Remote page, the
  `neledport` CLI, the MCP server and other machines. Paired devices connect over HTTPS whose TLS 1.2 is keyed by the
  device's own 256-bit pre-shared key (`ECDHE-PSK-CHACHA20-POLY1305`); the owner role exists only on 127.0.0.1, keyed
  by a file only the user can read. Creating or deleting servers, launch programs, config files, mods and Steam
  sign-in are never reachable from another machine. MCP uses the official `@modelcontextprotocol/server` 2.4; the CLI
  ships as one bundled file in `neledport.tgz` on each release.
- **Why:** the process that started a game server is the only one that can stop it cleanly, so the CLI and MCP talk to
  the running NeledPort instead of opening the data themselves. PSK works the same in Node and in Electron's BoringSSL
  (both checked as server and client on 2026-11-03), needs no certificates, and a wrong key fails the handshake.
  Per-device keys make revoking one PC possible; the role list keeps a leaked code from writing files or running code.
- **Trade-off:** TLS 1.2 only (BoringSSL has no external PSK in 1.3). On a Linux server without a desktop there is no
  keychain, so game passwords there are encoded in 0600 files. A control code is as strong as the game's admin console.
- **Rejected:** one shared password (no per-device revoke, no roles); self-signed certificates (no Node API to make
  them, and users click through warnings); a hand-written MCP server (the 2026-07-28 protocol changed its handshake);
  `npx github:` (it would install Electron on the server); reaching the data from the CLI directly (two processes
  would own the same game servers).

## 2026-10-31 · Every game full: each game's own control, proven on real servers

- **Decision:** No game stays "basic". Full means what the game's own server offers, taken from its official docs, its
  source code (Warfork, LocalAdmin), BattlEye's protocol description, well-used tools (SquadJS, NS2AdminLib,
  isle-evrima-rcon, the HumanitZ Docker template) or LinuxGSM. Games say how they are controlled in their definition
  (RCON commands and player-line patterns, config values written on every start, stop commands, Ctrl+C count, working
  folder, system packages); new protocols get one small client each (Quake RCON, Pavlov, The Isle, BattlEye, telnet,
  NS2 web admin, Satisfactory API). Games without a remote console get launchers, settings, configs and backups only.
- **Why:** a label is worth nothing if the server does not start or stop cleanly. The weekly real-server workflow ran
  every game a CI machine can host, and what it found changed the code: Unreal RCON plugins never echo Source's empty
  end packet, Soulmask's `quit` only closes the console, Conan needs two Ctrl+C, Chivalry needs its binary folder as
  the working directory, Steam's Double Action Linux files lack the game library.
- **Trade-off:** player-list formats nobody has published (Conan, MORDHAU, OHD, Unturned) fall back to the Steam query,
  so kick by ID is missing there; DayZ and Arma 3 need a Steam account that owns the game, so CI cannot run them.
  ARK on Linux quits on neither Ctrl+C (one or two) nor DoExit, so its stop saves the world over RCON and then closes
  it after the usual minute, as arkmanager does after 20 s; the real-server test checks the world file instead.
  `docs/GAMES.md` shows which games run on a real server.
- **Rejected:** shipping parsers guessed from hosting guides; claiming Satisfactory servers with a password the player
  never sees (they claim in game and give NeledPort their password); a free-form launch wrapper in definitions (only
  `xvfb-run`, which a shared definition cannot turn into another command).

## 2026-10-30 · GoldSrc games: app_set_config, UDP RCON, Metamod-AM for AMX Mod X

- **Decision:** HLDS (app 90) games set SteamCMD's `app_set_config 90 mod <mod>` before `app_update` (as WindowsGSM
  does) and are controlled with GoldSrc RCON over UDP on the game port. AMX Mod X installs with Metamod 1.21.1-am,
  the build AMX Mod X's own site links, plus `liblist.gam` pointed at Metamod and `addons/metamod/plugins.ini`.
- **Why:** real CS 1.6 and Day of Defeat servers on CI showed the mod setting downloads the right game (Day of
  Defeat's `dod/dlls/dod.so`) without LinuxGSM's seeded app manifests. Metamod-R's current docs say it needs ReHLDS,
  which would mean replacing Valve's engine.
- **Trade-off:** GoldSrc RCON answers on the public game port and HLDS echoes the password in its console, so
  NeledPort hides the password from the console and log, and the password is random (24 characters).
- **Rejected:** LinuxGSM's pre-seeded `appmanifest_*.acf` files (more moving parts, not needed on the real servers);
  Metamod-P (only `.tar.xz` builds, which Node cannot unpack without a new dependency).

## 2026-10-30 · Source engine games: RCON on the game port, name and password in neledport.cfg

- **Decision:** Source games are controlled over RCON on the game port (TCP), as srcds does. NeledPort writes
  `hostname` and `rcon_password` into `<mod>/cfg/neledport.cfg`, which `+servercfgfile` runs on every map, and keeps
  every other line. Bans use `banid 0 <id> kick` + `writeid`, loaded again at start with `+exec banned_user.cfg`.
  SourceMod comes from AlliedModders' build servers (`sm.alliedmods.net`, `mms.alliedmods.net`, now allowed), found
  through their `-latest-` files.
- **Why:** `srcds_run` passes arguments on unquoted, so a server name with spaces broke on the command line (seen on
  real CS:S and TF2 servers); the config file also keeps the password out of the process list. Windows executables
  come from Valve's app info, not guesses.
- **Trade-off:** RCON listens wherever the game listens. The password is random (24 characters) and srcds bans
  addresses after failed attempts; players only need the UDP port forwarded, so keep TCP closed on the router.
- **Rejected:** a per-game `server.cfg` template (users already edit their own); running the `srcds_linux` binary
  directly to dodge `srcds_run` (each game sets its own libraries and environment in that script).

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
