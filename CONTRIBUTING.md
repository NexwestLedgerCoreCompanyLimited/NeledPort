# Contributing to NeledPort

Thanks for helping! The easiest and most valuable contribution is adding or fixing a game.

## Add a game

**The easy way:** in NeledPort choose **Any Steam App ID**, install the server, pick the program that starts it, check
that it runs, then press **Share with the community**. NeledPort opens GitHub with the definition filled in; just create the
pull request.

**Test a basic game:** many games in [docs/GAMES.md](docs/GAMES.md) were imported from LinuxGSM and never run by a human.
If one works for you (or needs a fix), open a pull request that updates its file and say what you tested. Adding the
Windows launcher to a Linux-only game is a great first contribution.

**By hand:**

1. Find the server's SteamCMD App ID (the *Dedicated Server* app, not the game itself).
2. Copy [`games/palworld.json`](games/palworld.json) to `games/<id>.json`. The `id` is lowercase letters, digits and dashes, and must match the filename.
3. Fill in what you know. The [schema](games/schema.json) documents every field, and editors with JSON Schema support will autocomplete it.
   - `anonymous`: `true` if `steamcmd +login anonymous +app_update <appId>` works without owning the game.
   - `tier`: use `basic` unless the game has been tested end-to-end with players, bans and mods.
   - Paths are relative to the server's install folder. Absolute paths and `..` are rejected.
   - Arguments are a list of strings. `{port:<name>}` is replaced with the port named in `ports`.
4. Run `npm test`. It validates every file in `games/`.
5. Open a pull request and say which OS you tested on.

Only know the Linux or the Windows command line? Submit just that platform; someone else can add the other.

## Code changes

1. `npm install`, then `npm run dev`.
2. Write a failing test first for any logic change (`src/**/*.test.ts`, run with `npm test`).
3. Keep pull requests small and focused; one feature or fix per PR.
4. Before pushing: `npm run typecheck && npm test`.

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`, `ci:`).

## Releasing (maintainers)

Versions follow [Semantic Versioning](https://semver.org/); `0.x` releases are published as pre-releases.

1. Move the `Unreleased` notes in [CHANGELOG.md](CHANGELOG.md) under the new version and commit.
2. `npm version patch` (bug fixes), `npm version minor` (new features) or `npm version major`.
   This bumps `package.json`, commits, and creates the tag `vX.Y.Z`.
3. `git push --follow-tags`.

The [Release workflow](.github/workflows/release.yml) then builds the Windows and Linux installers and
publishes them as a GitHub Release with generated notes. It refuses to run if the tag and
`package.json` version differ.

## Ground rules

- Game definitions are **data only**. They never contain scripts or shell strings.
- No cheats, client-side injection or anti-cheat bypasses. Server-side mod loaders only.
- Never commit SteamCMD, game files, or Steam/game logos.

By contributing you agree that your work is released under the [MIT License](LICENSE) and that you follow the [Code of Conduct](CODE_OF_CONDUCT.md).
