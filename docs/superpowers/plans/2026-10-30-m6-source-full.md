# M6a: Source-engine games to full support

**Goal:** the 27 Source-engine (srcds) games in the catalog get everything a full game has: graceful stop, player list,
kick, ban/unban that survive restarts, console, Windows support, backups and one-click mods (Metamod:Source + SourceMod),
proven on real servers in CI.

**Research (sources):**
- SourceMod/Metamod install: extract both archives into the mod folder (`tf/`, `cstrike/`, …); `meta list` / `sm version`
  prove they loaded ([AlliedModders wiki](https://wiki.alliedmods.net/Installing_SourceMod)). Latest stable builds are
  named by `https://sm.alliedmods.net/smdrop/1.12/sourcemod-latest-<os>` and
  `https://mms.alliedmods.net/mmsdrop/1.12/mmsource-latest-<os>`; Linux builds are `.tar.gz`, Windows `.zip`. Both
  1.12 builds ship 64-bit binaries (TF2 runs `srcds_run_64`).
- Windows: `srcds.exe -console -game <mod>`; stop with `quit`; `server.cfg` sets `hostname` and `rcon_password`
  ([WindowsGSM Source engine](https://github.com/WindowsGSM/WindowsGSM/blob/master/WindowsGSM/GameServer/Engine/Source.cs)).
- Bans: `banid 0 <id> kick` then `writeid` writes `<mod>/cfg/banned_user.cfg`, which must be `exec`'d at start to
  survive a restart; `removeid <id>` + `writeid` unbans. Kick: `kickid "<id>" <reason>` (engine reassembles or matches
  the quoted id).
- SourceForts Classic and Zombie Master: Reborn install only the Source SDK 2013 base (app 244310); LinuxGSM downloads
  the mod itself from its own mirror. They are removed until someone adds that download.

## Tasks

1. **Mod loaders** (`src/core/mods.ts`, schema, catalog): several archives per loader, `latestFile` pointers,
   `.tar.gz` via system `tar`, `installTo` mod folder, `sm.alliedmods.net` / `mms.alliedmods.net` allowed.
2. **Source admin** (`src/core/admin.ts`): players from `status`, `kickid`, `banid`/`removeid`/`writeid`, bans read
   from `banned_user.cfg` (`source-cfg` format).
3. **Definitions:** every Source game gets RCON control + `quit`, server name and map settings, `+exec
   banned_user.cfg`, `-norestart`, a Windows launcher, `cfg` backups, `neledport.cfg` in Config, SourceMod (not Garry's
   Mod: its mods are Lua addons), tier `full`.
4. **UI:** a control port that is also the game port is not "keep local".
5. **Real servers in CI:** Counter-Strike: Source (32-bit) and Team Fortress 2 (64-bit): install, start, `status`,
   real ban/unban read back from the file, graceful `quit`, SourceMod loads (`sm version`).
6. Docs (README, GAMES.md, CHANGELOG, DECISIONS), release.

## Review focus

- A SteamID3 like `[U:1:123]` must stay one argument (quoted) in `kickid`/`banid`.
- The 64-bit TF2 server must load the 64-bit Metamod (`metamod_x64.vdf`).
- A loader download must never leave the server half-installed if the second archive fails.
