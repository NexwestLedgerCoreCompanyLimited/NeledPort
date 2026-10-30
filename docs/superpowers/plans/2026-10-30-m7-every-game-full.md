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

## Ledger

Status: todo → done (tested on a real server: yes / no + why).

| Game | LinuxGSM stop | Windows exe (Valve) | Plan | Status |
|---|---|---|---|---|
| sven-co-op | 9 | svends.exe | GoldSrc family (UDP RCON) | converted, real test pending |
| double-action-boogaloo | 3 | srcds.exe (-game dab) | Source family (RCON, SourceMod?) | converted, real test pending |
| cs2 | 9 | game/bin/win64/cs2.exe | Source RCON: status players, kick; bans if CS2 has them | todo |
| ark-survival-evolved | 2 | ShooterGame/Binaries/Win64/ShooterGameServer.exe | Source RCON (SaveWorld, DoExit, ListPlayers, Ban/Unban) | todo |
| conan-exiles | 16 | ConanSandboxServer.exe | Source RCON (Game.ini RconPlugin) | todo |
| squad | 2 | SquadServer.exe | Source RCON (Rcon.cfg), Bans.cfg | todo |
| squad-44 | 2 | PostScriptumServer.exe | as Squad | todo |
| insurgency-sandstorm | 2 | InsurgencyServer.exe | Source RCON (-Rcon), Bans.json | todo |
| mordhau | 2 | MordhauServer.exe | Source RCON (Game.ini) | todo |
| operation-harsh-doorstop | 2 | HarshDoorstopServer.bat | RCON port in LinuxGSM; check protocol | todo |
| satisfactory | 2 | FactoryServer.exe | HTTPS server API (save, shutdown) | todo |
| killing-floor-2 | 2 | Binaries/Win64/KFServer.exe | WebAdmin | todo |
| natural-selection-2 | 2 | x64/Server.exe | WebAdmin (-webadmin) | todo |
| ns2-combat | 2 | ns2combatserver.exe | WebAdmin (-webadmin) | todo |
| soulmask | 13 | (Linux app; Windows is a separate app) | telnet (-EchoPort) | todo |
| scp-secret-laboratory | 7 | LocalAdmin.exe | console `exit` | todo |
| unturned | 2 | ServerHelper.bat | console commands | todo |
| core-keeper | 2 | Launch.bat | Ctrl+C, world backups | todo |
| hurtworld | 2 | hurtworld.exe | check console | todo |
| the-isle | 2 | TheIsleServer.exe | check RCON | todo |
| pavlov-vr | 2 | (Linux listed) | Pavlov RCON | todo |
| warfork | 3 | wf_server_x64.exe | Quake-style RCON / console quit | todo |
| wurm-unlimited | 2 | WurmServerLauncher.exe | check | todo |
| chivalry-medieval-warfare | 2 | Binaries/Win32/UDK.exe | check | todo |
| day-of-dragons | 2 | DragonsServer.exe | check | todo |
| humanitz | 2 | (TSSGameServer.sh) | check | todo |
| hypercharge-unboxed | 2 | Unboxed/Binaries/Win64/UnboxedServer-Win64-Shipping.exe | check | todo |
| battalion-legacy | 2 | BattalionServer.exe | check | todo |
| stickybots | 2 | blank1/Binaries/Win64/blank1Server-Win64-Shipping.exe | check | todo |
| the-front | 2 | (Linux listed) | check | todo |
| tower-unite | 2 | (StartTowerServerUI.bat) | check | todo |
| runescape-dragonwilds | 2 | RSDragonwildsServer.exe | check | todo |
| dayz | 2 | DayZServer_x64.exe | BattlEye RCON; needs Steam login (no CI) | todo |
| arma-3 | 2 | (readme only) | BattlEye RCON; needs Steam login (no CI) | todo |
| scum | — | SCUM/Binaries/Win64/SCUMServer.exe | Windows only | todo |
| jedi-knight-ii-jedi-outcast | 3 | — | **removed**: Steam app is the game, Linux server comes from outside Steam | done (removed) |
| jedi-knight-jedi-academy | 3 | — | **removed**: as above | done (removed) |
| quake-4 | 3 | — | **removed**: as above | done (removed) |
