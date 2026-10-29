# Security Policy

NeledPort starts processes, downloads files and opens network ports on the user's machine, so we take
security reports seriously.

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private reporting instead:
**Security → Report a vulnerability** on this repository.

Include the affected version, your OS, and steps to reproduce. We aim to reply within 7 days.

## Scope

Issues we especially want to hear about:

- A game definition in `games/` that can make NeledPort run or write files outside the server's install folder.
- The renderer gaining access to Node.js or the file system.
- Secrets (RCON or admin passwords) being written to disk unencrypted or exposed in logs.
- Downloads that are not verified or that come from an unexpected host.

## Supported versions

Only the latest release receives security fixes during early development.
