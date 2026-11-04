# Contributing to NeledPort

Thanks for helping! The easiest and most valuable contribution is adding or fixing a game.

## Add a game

**The easy way:** in NeledPort choose **Any Steam App ID**, install the server, pick the program that starts it, check
that it runs, then press **Share with the community**. NeledPort opens GitHub with the definition filled in; just create the
pull request.

**Test a game:** games marked "—" under Real server in [docs/GAMES.md](docs/GAMES.md) have not run on a real server yet.
If one works for you (or needs a fix), open a pull request that updates its file and say what you tested. Adding the
Windows launcher to a Linux-only game is a great first contribution.

**By hand:**

1. Find the server's SteamCMD App ID (the *Dedicated Server* app, not the game itself).
2. Copy [`games/palworld.json`](games/palworld.json) to `games/<id>.json`. The `id` is lowercase letters, digits and dashes, and must match the filename.
3. Fill in what you know. The [schema](games/schema.json) documents every field, and editors with JSON Schema support will autocomplete it.
   - `anonymous`: `true` if `steamcmd +login anonymous +app_update <appId>` works without owning the game.
   - `tier`: `basic` while it only installs and starts; `full` once it does what the game's server offers.
   - Paths are relative to the server's install folder. Absolute paths and `..` are rejected.
   - Arguments are a list of strings. `{port:<name>}` is replaced with the port named in `ports`.
4. Run `npm test`. It validates every file in `games/`.
5. Open a pull request and say which OS you tested on.

Only know the Linux or the Windows command line? Submit just that platform; someone else can add the other.

## Translate NeledPort

NeledPort speaks English and Thai. Adding your language takes one file and no coding:

1. Copy [`src/core/locales/en.json`](src/core/locales/en.json) to `src/core/locales/<code>.json`
   (`de`, `es`, `pt-BR`, `zh-CN`, …) and translate the values. Keep the keys and every `{placeholder}` as they are.
2. Add it to `dictionaries` in [`src/core/i18n.ts`](src/core/i18n.ts).
3. Run `npm test`. It checks that keys and placeholders match English.

A partial translation is fine: anything you leave out shows in English. Game names and game settings come from the game
files and stay in English.

## Code changes

1. `npm install`, then `npm run dev`.
2. Write a failing test first for any logic change (`src/**/*.test.ts`, run with `npm test`).
3. Keep pull requests small and focused; one feature or fix per PR.
4. Before pushing: `npm run typecheck && npm test`.

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`, `ci:`).

## How the code is laid out

- `src/core`: everything that does the work, with no Electron in it. `manager.ts` runs servers; `api.ts` is the one door
  for the CLI, MCP and other machines, with roles; `remote.ts` and `host.ts` serve it; the rest is one small client per
  game protocol.
- `src/main` and `src/preload`: the Electron shell. `src/renderer`: the window (React). `src/cli`: `neledport` and MCP.
- `games/*.json`: one game each, checked against `games/schema.json`. `DECISIONS.md` says why things are as they are.

The window runs on macOS for development, but servers install and run only on Windows and Linux. Real-server tests live in
`src/e2e` and run from the E2E workflow on GitHub (`only` takes game ids, or `cli`); they download gigabytes.

## Forking

MIT lets you fork, rename and sell it; keep `LICENSE` and the copyright line. A fork should rename itself, because the name
and logo are not part of that licence, and before its first release change what still points here: `publish` in
`electron-builder.yml` (or your users update from this repository), `appId` there, `REPO` in `src/main/index.ts`,
`REPO_URL` in `src/renderer/src/components/Sidebar.tsx`, and the links in the READMEs and docs. Releases need no secrets:
enable Actions on the fork and push a tag. The `npm` job fails until you publish under your own package name on npmjs.com
and add your repository there as its Trusted Publisher; rename `name` in `scripts/build-cli.mjs` first.

## Releasing (maintainers)

Versions follow [Semantic Versioning](https://semver.org/); tags with a suffix such as `v1.1.0-beta.1` are published as
pre-releases, the rest as GitHub's Latest.

1. Move the `Unreleased` notes in [CHANGELOG.md](CHANGELOG.md) under a new `## [X.Y.Z] - date` heading, as
   English bullet points grouped under `### Added`, `### Fixed` and so on, and commit. This section becomes the
   text of the GitHub Release.
2. `npm version patch` (bug fixes), `npm version minor` (new features) or `npm version major`.
   This bumps `package.json`, commits, and creates the tag `vX.Y.Z`.
3. `git push --follow-tags`.

The [Release workflow](.github/workflows/release.yml) then builds the Windows and Linux installers and
publishes them, with the `neledport` CLI package (`neledport-X.Y.Z.tgz` and `neledport.tgz`, also sent to npm), as a GitHub Release
whose text is that CHANGELOG section (`node scripts/release-notes.mjs X.Y.Z` shows it). It refuses to run if the tag
and `package.json` version differ, if CHANGELOG.md has no notes for the version, or if the docs' `neledport.tgz`
links point at another version.

## Ground rules

- Game definitions are **data only**. They never contain scripts or shell strings.
- No cheats, client-side injection or anti-cheat bypasses. Server-side mod loaders only.
- Never commit SteamCMD, game files, or Steam/game logos.

By contributing you agree that your work is released under the [MIT License](LICENSE) and that you follow the [Code of Conduct](CODE_OF_CONDUCT.md).
