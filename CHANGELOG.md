# Changelog

All notable changes to NeledPort are listed here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). Versions below 1.0.0 are early previews.

## [Unreleased]

## [1.0.0] - 2026-11-04

The first release for everyone: GitHub's Latest, not a pre-release.

### Fixed

- **Stopping a server on Windows lets it save.** NeledPort sent a hard kill to games without a remote console, Valheim
  among them, losing what they had not saved. It now sends Ctrl+C through the server's console and waits, as on Linux; a
  server with no console is closed as before, after a backup. RCON games such as ARK now save over RCON on Windows too.
- A server whose game left the catalog, or whose password cannot be read, shows with the reason instead of leaving the
  whole app empty. If one list fails to load, the others still appear.
- Closing the window with servers running asks first, and Cancel keeps the window; it used to leave a hidden app with no
  way back. Launching NeledPort again brings the window back.
- Backups: a failed backup leaves no broken file in the list and no longer blocks Stop; each kind keeps its own newest
  copies, so frequent stop copies cannot push out your manual or pre-update ones; a failed restore puts the world back.
- Revoking a device, or changing its role, applies at once to connections it already has open.
- On Linux, SteamCMD failing to start for lack of 32-bit libraries says which packages to install.
- `neledport serve --start` with an unknown server fails visibly instead of hosting nothing.
- Server pages no longer show a broken picture when the game's art cannot load.
- The catalog importer no longer overwrites definitions that have moved past "basic".

### Changed

- The Overview page no longer promises that players can join: it says who can, and the README explains port forwarding,
  firewalls and CGNAT. The catalog hides its filter while every game has the same support.
- Installers and the `neledport` package carry LICENSE, THIRD_PARTY_NOTICES.md and every bundled library's licence.
- New screenshots and tour. Docs for a working systemd setup, forking, the code layout, and a warning that the AI reads
  text written by players.

## [0.9.1] - 2026-11-03

### Fixed

- `neledport serve` and `neledport mcp` say plainly that NeledPort already runs on the machine (or why they could not
  start) instead of printing a stack trace.
- The MCP `list_games` tool reports an unreachable NeledPort instead of answering with an empty list.
- Adding a machine without a name works when the machine's hostname is longer than 60 characters.
- Remote calls no longer rewrite `devices.json` each time; a device's last sighting is saved at most once a minute.

## [0.9.0] - 2026-11-03

### Added

- **Remote machines.** The app's new Remote page watches and controls the game servers on another computer (a Linux
  VPS, a Windows Server): its CPU, memory and disk, every server with its players, and start, stop, restart and back up.
  The other side turns remote access on (off by default) and pairs each device with its own code and role (view or
  control). The code is the TLS pre-shared key of the connection, so a wrong one fails before anything is read;
  addresses that keep trying are blocked; every action and refusal is logged; creating or deleting servers, launch
  programs, config files, mods and Steam sign-in never work from another machine. See `docs/REMOTE.md`.
- **`neledport` on the command line**, as `npx` from each release (`neledport.tgz`): `serve` hosts servers on a Linux
  server without a screen (`--start` for systemd), and `list`, `create`, `install`, `start`, `stop`, `cmd`, `logs`,
  `devices`, `remote`, `activity` and `steam-login` manage them there or, with `--machine`, on a paired machine.
- **MCP server** (`neledport mcp`): Claude and other MCP clients can list, start, stop, update, back up servers, run
  console commands and manage players, under the same roles and activity log.

- **Every game in the catalog now has full support**: no game is left at "basic". For each one NeledPort does what the
  game's own dedicated server offers, checked against its official docs, its source code or LinuxGSM: a stop that
  saves the world, the player list, kick and bans, a console, config files in the Config tab, backups of its saves
  and a mod loader, where the game has them. `docs/GAMES.md` lists what each game has.
- Remote control for the games that have one, switched on for you with the server's generated password:
  - RCON in the game's own config file for ARK, Conan Exiles, Squad, Squad 44, Insurgency: Sandstorm, MORDHAU,
    Operation: Harsh Doorstop and HumanitZ; the Console tab, player lists and bans follow each game's own commands.
    ARK saves its world over RCON before a stop, then is closed after a minute: on Linux it quits on neither Ctrl+C
    nor DoExit (arkmanager closes it the same way).
  - Satisfactory's server API: stopping saves the running game and shuts down with the admin password you set when
    claiming the server.
  - SCP: Secret Laboratory's own console (LocalAdmin); Soulmask's telnet console; Warfork's Quake-style RCON; Pavlov
    VR's RCON; The Isle's RCON; Natural Selection 2's web admin (Basic or Digest login).
  - BattlEye RCon for DayZ and Arma 3 (players, kick, bans).
- **Metamod:Source** in one click for Counter-Strike 2, with AlliedModders' gameinfo.gi step applied again after each
  game update. **Oxide** in one click for Hurtworld.
- Windows launchers from Valve's own app data for 25 more games.
- Games that only run on Linux under a virtual display (Core Keeper, Wurm Unlimited) are started under `xvfb-run`, and
  servers that need a system package name it in the console when they stop unexpectedly.
- Game definitions can now also say: a Steam beta branch (HumanitZ's Linux build, The Isle's Evrima), files LinuxGSM
  puts beside a server (steamclient.so, steam_appid.txt, a system libc++), a starting world to copy once (Wurm), the
  folder to start in (Unreal Engine 3 games), how many Ctrl+C a stop needs (Conan Exiles), and the text that says a
  save finished (Soulmask).
- Servers created before their game went full keep working: new ports and settings are added with their defaults.
- The weekly real-server test now covers 37 games, and `docs/GAMES.md` says which ones.

- **9 GoldSrc (Half-Life 1) games now have full support**: Counter-Strike 1.6, Condition Zero, Day of Defeat, Team
  Fortress Classic, Half-Life Deathmatch, Opposing Force, Ricochet, Deathmatch Classic and Base Defense. Each gets
  the right game downloaded (HLDS serves several), RCON over UDP with a clean quit, the player list, kick, bans that
  survive restarts, the console, a server name and start map, and Windows support (Base Defense: Linux).
- **AMX Mod X** with Metamod installs in one click on 8 of them, following AMX Mod X's own install guide. Plugins you
  add, disable or remove are kept in step with AMX Mod X's `plugins.ini`.
- Counter-Strike 1.6 and Day of Defeat join the weekly real-server test: the right game installed, RCON, real bans, a
  clean quit and AMX Mod X loading.

### Changed

- RCON replies end once the server goes quiet instead of waiting for an echoed empty packet, which Unreal Engine
  servers' RCON plugins never send back.
- Generated admin passwords are letters and digits only (36 hex characters). Older ones with "-" or "_" are replaced
  at the next start: Natural Selection 2 splits its command line at every "-".
- Unturned starts the official way (`+InternetServer` with Commands.dat) and stops with Ctrl+C like Hurtworld: neither
  reads commands from NeledPort, so they have no Console tab.
- Double Action: Boogaloo runs on Windows only: Steam's Linux files lack the game's server library.
- `servers.json` is readable by its user only: it holds game admin passwords.
- An install that SteamCMD ends with "state is 0x…" shows that line instead of only an exit code, and runs once more:
  Half-Life servers (Counter-Strike 1.6, Day of Defeat) often need a second run.

### Removed

- Games that install from outside Steam, which NeledPort cannot do yet: Action Half-Life, BrainBread, Natural
  Selection, The Specialists and Vampire Slayer. Any Steam App ID still installs Half-Life servers by hand.
- Jedi Knight II, Jedi Academy and Quake 4: their Steam apps are the games, and their Linux servers come from outside
  Steam.

### Security

- The RCON password never appears in the console or `server.log`, even though HLDS prints it with every command.
- Natural Selection 2 and NS2: Combat no longer open their web admin on every network interface with the password
  `CHANGE_ME`; it listens on this machine only, with the server's generated password.
- Counter-Strike 2 and Insurgency: Sandstorm no longer take the RCON password on the command line, where any user of
  the machine could read it.

## [0.8.0] - 2026-10-30

### Added

- **25 Source engine games now have full support**: Team Fortress 2, Counter-Strike: Source, Garry's Mod, Left 4 Dead
  and Left 4 Dead 2, Insurgency, Day of Defeat: Source, Half-Life 2: Deathmatch, No More Room in Hell, Black Mesa and
  more. Each gets a safe stop over RCON, the player list with SteamIDs, kick, bans that survive restarts, the console,
  a server name and start map, Windows support, backups of its `cfg` folder and its config file in the Config tab.
- **SourceMod** (with Metamod:Source) installs in one click on 23 of them, straight from AlliedModders' latest stable
  builds. Add `.smx` plugins in the Mods tab. (Garry's Mod uses Lua addons instead.)
- Mod loaders can now come as several `.tar.gz` or `.zip` archives and unpack into a game's own folder.
- Team Fortress 2 (64-bit) and Counter-Strike: Source join the weekly real-server test: RCON, real bans, a clean
  quit and SourceMod loading.

### Changed

- The server name and RCON password of Source games are written to `<mod>/cfg/neledport.cfg` on every start, so a
  name with spaces works and the password is not on the process command line.

### Removed

- Games that could not work: Counter-Strike: Global Offensive (Valve retired its dedicated server), SourceForts
  Classic and Zombie Master: Reborn (they need mod files from outside Steam) and Team Fortress 2 Classified (it needs
  the TF2 server installed next to it). Any Steam App ID still installs them by hand.

### Fixed

- The Overview no longer says to keep the game port local when the remote console shares it (Source games, CS2).

## [0.7.1] - 2026-10-30

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

[Unreleased]: https://github.com/NexwestLedgerCoreCompanyLimited/NeledPort/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/NexwestLedgerCoreCompanyLimited/NeledPort/compare/v0.9.1...v1.0.0
[0.9.1]: https://github.com/NexwestLedgerCoreCompanyLimited/NeledPort/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/NexwestLedgerCoreCompanyLimited/NeledPort/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/NexwestLedgerCoreCompanyLimited/NeledPort/compare/v0.7.1...v0.8.0
[0.7.1]: https://github.com/NexwestLedgerCoreCompanyLimited/NeledPort/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/NexwestLedgerCoreCompanyLimited/NeledPort/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/NexwestLedgerCoreCompanyLimited/NeledPort/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/NexwestLedgerCoreCompanyLimited/NeledPort/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/NexwestLedgerCoreCompanyLimited/NeledPort/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/NexwestLedgerCoreCompanyLimited/NeledPort/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/NexwestLedgerCoreCompanyLimited/NeledPort/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/NexwestLedgerCoreCompanyLimited/NeledPort/releases/tag/v0.1.0
