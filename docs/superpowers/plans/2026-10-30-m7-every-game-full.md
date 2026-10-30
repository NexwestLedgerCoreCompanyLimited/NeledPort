# M7: every remaining game to full support

**Goal (from the maintainer):** no "basic" games left; bring each one to full, game by game, then one big release.

**What "full" means for a game:** everything that game's own dedicated server offers, done properly and checked against
an official or primary source: the launcher on Windows and Linux (from Valve's app info), a stop that saves the world,
the player list, kick and bans where the server has them, server name/password settings, backups of the save folder,
its config files in the Config tab, and a one-click mod loader where one exists. Where a game has no RCON or ban
system, NeledPort does not invent one; GAMES.md lists what each game has. Games that cannot be tested on a real server
in CI (Steam login, too big for a runner) are marked "not tested on a real server" in GAMES.md.

**Rule kept from M6:** a game that needs files from outside Steam, or a second app, is removed rather than shipped broken.

## Sources gathered (2026-10-30)

- Valve app info (SteamCMD `app_info_print`, run on a GitHub runner): Windows executables below.
- LinuxGSM `lgsm/config-default/config-lgsm/<x>server/_default.cfg`: start parameters and `stopmode`
  (2 = Ctrl+C, 3 = `quit` on the console, 7 = `exit`, 9 = GoldSrc quit, 13 = Soulmask telnet, 16 = Conan routine).

## Building blocks added for these games

- `configWrites` (per platform): values written into the game's own config on every start.
- `players.command` / `players.pattern` / `players.kick`, `bans.ban` / `bans.unban` / `bans.save`: RCON commands named
  by the definition.

## Ledger

Status: todo → done (tested on a real server: yes / no + why).

| Game | LinuxGSM stop | Windows exe (Valve) | Plan | Status |
|---|---|---|---|---|
| sven-co-op | 9 | svends.exe | GoldSrc family (UDP RCON) | done (real server: yes; no AMX Mod X, Sven has its own AngelScript plugins) |
| double-action-boogaloo | 3 | srcds.exe (-game dab) | Source family (RCON, SourceMod) | done, Windows only (real server: no). Ruling: Steam's Linux depot has no dab/bin/*.so; gdb shows srcds crashing in CModAppSystemGroup::Create on a null call (probe run 41083505889), so Linux is dropped — cost if wrong: Linux users lose a game that never ran |
| cs2 | 9 | game/bin/win64/cs2.exe | Source RCON: status players, kick; bans if CS2 has them | done; real server: run pending (CI 41128xxx) |
| ark-survival-evolved | 2 | ShooterGame/Binaries/Win64/ShooterGameServer.exe | Source RCON (SaveWorld, DoExit, ListPlayers, Ban/Unban) | done; real server: pending (RCON never answered in run 1; URL switches added) |
| conan-exiles | 16 | ConanSandboxServer.exe | Source RCON (Game.ini RconPlugin) | done (real server: yes) |
| squad | 2 | SquadServer.exe | Source RCON (Rcon.cfg), Bans.cfg | done (real server: yes) |
| squad-44 | 2 | PostScriptumServer.exe | as Squad | done (real server: yes) |
| insurgency-sandstorm | 2 | InsurgencyServer.exe | Source RCON (-Rcon), Bans.json | done (real server: yes) |
| mordhau | 2 | MordhauServer.exe | Source RCON (Game.ini) | done (real server: yes) |
| operation-harsh-doorstop | 2 | HarshDoorstopServer.bat | RCON port in LinuxGSM; check protocol | done (real server: yes) |
| satisfactory | 2 | FactoryServer.exe | HTTPS server API (save, shutdown) | done (real server: yes, claim + save + shutdown) |
| killing-floor-2 | 2 | Binaries/Win64/KFServer.exe | WebAdmin | done (real server: yes) |
| natural-selection-2 | 2 | x64/Server.exe | WebAdmin (-webadmin) | done; real server: pending (workingDir x64) |
| ns2-combat | 2 | ns2combatserver.exe | WebAdmin (-webadmin) | done; real server: pending (workingDir ia32) |
| soulmask | 13 | (Linux app; Windows is a separate app) | telnet (-EchoPort) | done (real server: yes; stop is "close 1") |
| scp-secret-laboratory | 7 | LocalAdmin.exe | console `exit` | done; real server: pending |
| unturned | 2 | ServerHelper.bat | console commands | done; real server: pending (official +InternetServer start) |
| core-keeper | 2 | Launch.bat | Ctrl+C, world backups | done (real server: yes) |
| hurtworld | 2 | hurtworld.exe | check console | done; real server: pending (server exits after start; Unity log next run) |
| the-isle | 2 | TheIsleServer.exe | check RCON | done; real server: pending (evrima branch) |
| pavlov-vr | 2 | (Linux listed) | Pavlov RCON | done; real server: pending (libc++ copy) |
| warfork | 3 | wf_server_x64.exe | Quake-style RCON / console quit | done (real server: yes) |
| wurm-unlimited | 2 | WurmServerLauncher.exe | check | done (real server: yes) |
| chivalry-medieval-warfare | 2 | Binaries/Win32/UDK.exe | check | done; real server: pending (steam_appid.txt, binary folder) |
| day-of-dragons | 2 | DragonsServer.exe | check | done (real server: yes) |
| humanitz | 2 | (TSSGameServer.sh) | check | done (real server: yes) |
| hypercharge-unboxed | 2 | Unboxed/Binaries/Win64/UnboxedServer-Win64-Shipping.exe | check | done (real server: yes) |
| battalion-legacy | 2 | BattalionServer.exe | check | done; real server: pending (query port 27015) |
| stickybots | 2 | blank1/Binaries/Win64/blank1Server-Win64-Shipping.exe | check | done (real server: yes) |
| the-front | 2 | (Linux listed) | check | done (real server: yes) |
| tower-unite | 2 | (StartTowerServerUI.bat) | check | done (real server: yes) |
| runescape-dragonwilds | 2 | RSDragonwildsServer.exe | check | done (real server: yes) |
| dayz | 2 | DayZServer_x64.exe | BattlEye RCON; needs Steam login (no CI) | done (real server: no, needs a Steam account that owns it) |
| arma-3 | 2 | (readme only) | BattlEye RCON; needs Steam login (no CI) | done (real server: no, needs a Steam account that owns it) |
| scum | — | SCUM/Binaries/Win64/SCUMServer.exe | Windows only | done (real server: no, Windows only) |
| jedi-knight-ii-jedi-outcast | 3 | — | **removed**: Steam app is the game, Linux server comes from outside Steam | done (removed) |
| jedi-knight-jedi-academy | 3 | — | **removed**: as above | done (removed) |
| quake-4 | 3 | — | **removed**: as above | done (removed) |

## Research findings (four research passes, 2026-10-30) and rulings

Primary sources: LinuxGSM configs, Game-Server-Configs templates, official docs (NWI admin guide, Unturned-Docs,
Tower Unite guides, conanexiles.com, LocalAdmin-V2 source), well-used tools (SquadJS, arkmanager, ark_rcon, Pterodactyl
eggs, AMP templates). "unconfirmed" = no primary source; those parts are verified on a real server in CI or left out.

- Ruling: kick for a2s-listed players uses an explicit `players.kick` template with `{name}` (quoted), not a hidden
  default — a non-Source game must never get Source's `kick "name"` by accident. Cost if wrong: one template per game.
- Ruling: one generic real-server E2E (`rcon.e2e.test.ts`) for UE RCON games: install, start, RCON answers, player
  list parses, ban/unban round trip, graceful stop, backup. Cost if wrong: CI minutes only (public repo).

| Game | Control | Players / kick | Bans | Saves / configs |
|---|---|---|---|---|
| ARK | RCON: GameUserSettings.ini [ServerSettings] RCONEnabled, RCONPort, ServerAdminPassword; SaveWorld + DoExit | `ListPlayers` `^\d+\. name, steam64$`; `KickPlayer {id}` | `BanPlayer`/`UnbanPlayer {id}`; file unconfirmed | ShooterGame/Saved; GameUserSettings.ini, Game.ini |
| Conan | RCON: Game.ini [RconPlugin] RconEnabled/RconPassword/RconPort; stop Ctrl+C (LinuxGSM 16) | a2s (listplayers format unconfirmed) | `banplayer`; unban = remove line from ConanSandbox/Saved/blacklist.txt | ConanSandbox/Saved (game.db); ServerSettings/Game/Engine.ini |
| Squad | RCON: SquadGame/ServerConfig/Rcon.cfg Port/Password; stop Ctrl+C | `ListPlayers` SquadJS regex, steam id in Online IDs; `AdminKick "{id}" {reason}` | `AdminBan "{id}" 0 {reason}`; Bans.cfg `id:ts //Reason` | no saves; ServerConfig/*.cfg |
| Squad 44 | as Squad under PostScriptum/ | as Squad (format unconfirmed) | as Squad | as Squad |
| Sandstorm | RCON: Game.ini [Rcon] bEnabled/Password/ListenPort | `listplayers` ids `SteamNWI:\d+` | `ban`/`unban {id}`; Bans.json unconfirmed | no saves; Game.ini, Engine.ini, Admins.txt, MapCycle.txt |
| Mordhau | RCON: Game.ini [/Script/Mordhau.MordhauGameSession] RconPort/RconPassword; `shutdown`? | `playerlist` PlayFab ids (format unconfirmed) | `ban {id} 0`/`unban {id}` | no saves; Game.ini, Engine.ini |
| OHD | RCON plugin Game.ini [/Script/RCON.RCONServerSystem] bEnabled/ListenPort/Password | `status` (unconfirmed) | Bans.cfg `id:0` + RELOADSERVERCONFIG | no saves |
| CS2 | Source RCON on game port, `quit` | `status` (format unconfirmed) / a2s | none built in (banid is dev-only) | game/csgo/cfg |
| HumanitZ | Source RCON: GameServerSettings.ini [Host Settings] RCONEnabled/RConPort/RCONPass; `save`, `shutdown` | `Players`; `kick {id}` | `ban`/`unban {id}` | Linux build on beta `linuxbranch` |
| SCP:SL | stdin of LocalAdmin; `exit` | `players` `- Nick: id@steam [n]` | `/ban n 0` kicks; `/oban id dur reason`, `/unban id <id>`; config/<port>/UserIdBans.txt | no saves; ~/.config/SCP Secret Laboratory/config/<port>/ |
| Unturned | stdin; `Save` then `Shutdown` | `Players` (format unconfirmed); `Kick <id>/<reason>` | `Ban <id>/<reason>/<secs>`, `Unban <id>` | Servers/<ID>/ (Commands.dat, Config.txt) |
| Core Keeper | Ctrl+C; no console | log lines `[userid:<id>] player <name> connected` | none | -datapath dir; ServerConfig.json |
| Hurtworld | stdin; `saveserver`, `quit` | a2s | unconfirmed | autoexec.cfg |
| Wurm | GUI/RMI only | a2s | none | <World>/ |
| Chivalry | binary SHA1 RCON (push events) | a2s | RCON packets | PCServer-UDKGame.ini |
| Tower Unite | none; pkill | a2s | TowerBans.ini (in game only) | Tower/Condos; TowerServer.ini |
| The Front | stdin (unconfirmed); autosave | log lines `account=STEAM:<id>` | unconfirmed | TheFrontManager/ServerConfig_*.ini |
| Satisfactory | HTTPS API (Bearer): SaveGame, Shutdown | none | none | ~/.config/Epic/FactoryGame/Saved/SaveGames/server |
| Soulmask | telnet -EchoPort: `saveworld 1`, `quit 1` | — | — | WS/Saved/Worlds/Dedicated |
| Pavlov | TCP RCON, MD5 auth (RconSettings.txt) | RefreshList | Ban/Unban | Linux only |
| Warfork | Quake UDP rcon; `status` has SteamID64 | status | ban/removeban, listip.cfg | — |
| The Isle | custom binary RCON (Game.ini) | — | — | — |
| KF2, NS2, NS2 Combat | WebAdmin (HTML) only | a2s | — | — |
| No RCON: Day of Dragons, Dragonwilds, Battalion, Hypercharge, StickyBots | Ctrl+C | a2s | — | launcher, settings, backups, configs only |
| DayZ, Arma 3 | BattlEye UDP RCON; Steam login needed (no CI) | — | — | — |
| SCUM | Windows only, no RCON | a2s | — | SCUM/Saved/SaveFiles |
