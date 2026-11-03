# Linux servers, remote machines and AI (MCP)

NeledPort also runs without a window, on a Linux server or a Windows Server. The app on your PC can then watch and
control it, and an AI can run it through the Model Context Protocol (MCP).

## Run NeledPort on a Linux server without a screen

You need Node.js 20.10 or newer. Then install the 32-bit libraries SteamCMD needs (Debian/Ubuntu):

```bash
sudo dpkg --add-architecture i386 && sudo apt-get update && sudo apt-get install -y lib32gcc-s1 lib32stdc++6
```

Run it straight from a release (this is v0.9.1; the newest is on
[Releases](https://github.com/NexwestLedgerCoreCompanyLimited/NeledPort/releases)):

```bash
npx --yes --package https://github.com/NexwestLedgerCoreCompanyLimited/NeledPort/releases/download/v0.9.1/neledport.tgz neledport serve
```

Or install it once and use `neledport` from then on:

```bash
npm install -g https://github.com/NexwestLedgerCoreCompanyLimited/NeledPort/releases/download/v0.9.1/neledport.tgz
```

`neledport serve` hosts the servers and keeps running; Ctrl+C (or SIGTERM) saves and stops every server first. In a
second terminal:

```bash
neledport games valheim
neledport create valheim "Friday Valheim" --set password=change-me
neledport install "Friday Valheim"
neledport start "Friday Valheim"
neledport list
```

Games that need a Steam account that owns them (DayZ, Arma 3): `neledport steam-login <account>`. SteamCMD asks for
the password and Steam Guard code itself; NeledPort never sees them. `neledport help` lists every command.

### Keep it running with systemd

`/etc/systemd/system/neledport.service`, for a user called `games`:

```ini
[Unit]
Description=NeledPort game servers
After=network-online.target
Wants=network-online.target

[Service]
User=games
ExecStart=/usr/bin/neledport serve --start "Friday Valheim"
# Servers save before they stop; big worlds take a while.
TimeoutStopSec=300
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Then `sudo systemctl enable --now neledport`. `--start` names the servers to start once NeledPort is up (repeat it for
more). Use `neledport` as that user (`sudo -u games neledport list`): each user has their own servers and data.

## Watch and control it from your PC

1. On the server machine, turn remote access on: `neledport remote on` (port 47800 on every network; add
   `--port` or `--host` to change that), or the **Remote** page of the app.
2. Pair your PC: `neledport devices add "My PC" --role control` (or `--role view`). It prints a pairing code once.
3. Open TCP 47800 in the server's firewall. Allow only your own address if you can, or use a VPN such as Tailscale and
   never open the port to the internet.
4. In the app on your PC: **Remote machines → Add a machine**, with the server's address and the code.

You then see its CPU, memory, disk and every game server with its players, refreshed every 10 seconds, and with a
`control` code you can start, stop, restart and back up servers. From a terminal on any machine, add
`--machine <address>` with the code in `NELEDPORT_CODE`:

```bash
NELEDPORT_CODE=np1.… neledport list --machine 203.0.113.5
```

### What each code allows

| Role | Can |
|---|---|
| view | machine status, servers, players, bans, the game list |
| control | view, plus start, stop (saves first), restart, update, back up, kick, ban, unban, console commands and console output |
| owner | everything, from the machine itself only (the CLI, the app, a local MCP server) |

No code, whatever its role, can create or delete servers, choose the program a server starts, edit config files,
install mods or sign in to Steam from another machine: those write files or run code, so they stay on the machine
itself. View codes do not get console output, where some games print their admin password. Console commands are the
game's own (RCON or its console), so a control code is as strong as the game's admin console: give it only to people
you would give that to.

### How it is protected

- **Off by default.** Nothing listens on the network until the owner turns remote access on.
- **One key per device.** Each pairing code holds a random 256-bit key. It is the TLS pre-shared key of the connection
  (TLS 1.2, `ECDHE-PSK-CHACHA20-POLY1305`): it never crosses the network, a wrong code fails the handshake before any
  request is read, and the ECDHE exchange gives forward secrecy. No certificates to manage or click through.
- **Revoke one device** (`neledport devices revoke <id>` or the app); the others keep working.
- **Brute force:** 10 failed handshakes from one address within 10 minutes block it for 15 minutes. At most 32
  connections, 64 KB per request.
- **Activity log:** every action and refused connection, with the device and its address (`neledport activity`, or
  the app). Plain viewing is not logged.
- **Files:** `devices.json`, `local.json` (this machine's own key, for the CLI and MCP on 127.0.0.1) and `servers.json`
  are readable by their user only. The app seals the codes of the machines it watches with the OS keychain. On a
  Linux server without a desktop there is no keychain, so game admin passwords there are only encoded, in files only
  that user can read.

## Let an AI run it (MCP)

`neledport mcp` is an MCP server over stdio. Its tools: `machine_status`, `list_servers`, `server_status`,
`list_players`, `list_bans`, `list_games`, `console_output`, `start_server`, `stop_server`, `restart_server`,
`update_server`, `backup_server`, `run_command`, `kick_player`, `ban_player`, `unban_player`, and with
`--allow-create`, `create_server` and `install_server`. Each is one call to NeledPort, so the same roles and activity
log apply. Tools that change something carry MCP's destructive or write hints, so clients can ask before running them.

NeledPort must be running on that machine (the app or `neledport serve`). Claude Code:

```bash
claude mcp add neledport -- npx --yes --package https://github.com/NexwestLedgerCoreCompanyLimited/NeledPort/releases/download/v0.9.1/neledport.tgz neledport mcp
```

Claude Desktop and other clients, after `npm install -g` as above (`claude_desktop_config.json` or the client's MCP
settings):

```json
{
  "mcpServers": {
    "neledport": {
      "command": "neledport",
      "args": ["mcp"]
    }
  }
}
```

For another machine, pair the AI as its own device (`neledport devices add "AI" --role control`) and pass the code in
the environment, not in the arguments, where other users of the machine could see it:

```json
{
  "mcpServers": {
    "neledport-vps": {
      "command": "neledport",
      "args": ["mcp", "--machine", "203.0.113.5"],
      "env": { "NELEDPORT_CODE": "np1.…" }
    }
  }
}
```
