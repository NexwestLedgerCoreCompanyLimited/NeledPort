# M0 Repo Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish `NEXWEST-LEDGER-CORE/NeledPort` as a public MIT repo with community files, green CI, and an Electron app shell that opens a window and lists games from `games/*.json`.

**Architecture:** electron-vite project with three entry points (main, preload, renderer). Game definitions are data-only JSON validated by one JSON Schema (`games/schema.json`) through `src/core/catalog.ts`, which has no Electron imports so Vitest can test it directly. The renderer gets the catalog only through a typed preload bridge.

**Tech Stack:** Electron 44.10, electron-vite 6.0, Vite 8.3, React 19.3, Tailwind CSS 4.3 (`@tailwindcss/vite`), TypeScript 6.0.3, Vitest 5.0, Ajv 8.20, electron-builder 26.18.

**Spec:** `docs/superpowers/specs/2026-10-29-neledport-design.md`

## Global Constraints

- License MIT, copyright holder "NEXWEST-LEDGER-CORE contributors".
- Repo `NEXWEST-LEDGER-CORE/NeledPort`, public; default branch `main`.
- Commit author `Nai Natthawut <283197608+NexwestLedgerCoreCompanyLimited@users.noreply.github.com>` (repo-local git config); every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `.gitignore` excludes `.claude/`, `.playwright-mcp/`, `.remember/`, `.zcode/`, `.DS_Store`, `node_modules/`, `out/`, `dist/`.
- Electron window: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`; external links open in the system browser.
- Game definitions are data only; every path in them is relative and stays inside the install dir.
- No SteamCMD binaries, game files, or Steam logos in the repo.
- npm cache: run npm with `npm_config_cache=$TMPDIR/npm-cache` in this sandbox (the home cache is not writable).

## Review Focus

1. A malformed or invalid `games/*.json` → app still starts, valid games still listed, error names the file. (Task 2 tests)
2. A definition path like `../../etc/passwd`, `/etc/x`, or `C:\x` → rejected with the file name. (Task 2 tests)
3. Packaged app where the `games` folder is missing → empty list plus an error, no crash. (Task 2 test: nonexistent dir)
4. Definition `id` not matching its filename → rejected, so two files cannot claim one id. (Task 2 test)
5. Local tool folders or secrets accidentally committed → `git status --ignored` check before the first commit. (Task 1 step)

---

### Task 1: Repo skeleton and community files

**Files:** Create `.gitignore`, `LICENSE`, `README.md`, `README.th.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `DECISIONS.md`, `.github/ISSUE_TEMPLATE/{bug.yml,game-request.yml,config.yml}`, `.github/pull_request_template.md`.

- [ ] **Step 1:** `git init -b main`, set repo-local `user.name` / `user.email` from Global Constraints.
- [ ] **Step 2:** Write the files. README: one-line pitch, status badge "early development", feature list from spec §2, supported-games table (Palworld only, marked "in progress"), "Add your game" pointer to CONTRIBUTING, dev setup (`npm install`, `npm run dev`, `npm test`), license. CONTRIBUTING: how to add `games/<id>.json`, run `npm test`, commit style. DECISIONS: license MIT, Electron + React + TS, JSON files not DB, Ajv schema as single source of truth, ESLint/Playwright deferred to M1.
- [ ] **Step 3: Verify nothing private is staged.** Run `git add -A && git status --short` — Expected: no paths under `.claude/`, `.playwright-mcp/`, `.remember/`, `.zcode/`, no `.DS_Store`.
- [ ] **Step 4: Commit** `chore: initial repo skeleton and community files`.

### Task 2: Game catalog schema and loader

**Files:** Create `games/schema.json`, `games/palworld.json`, `src/core/catalog.ts`, `src/core/catalog.test.ts`.

**Interfaces:**
- Produces: `export type GameDefinition` (fields below) and
  `export function loadCatalog(dir: string): { games: GameDefinition[]; errors: CatalogError[] }`,
  `export type CatalogError = { file: string; message: string }`. Games sorted by `name`. Never throws.

Schema (draft 2020-12, `additionalProperties: false` at top level). Required: `id` (`^[a-z0-9][a-z0-9-]*$`), `name`, `serverAppId` (integer ≥ 1), `anonymous` (boolean), `tier` (`full|basic|custom`), `platforms` (object with optional `windows` / `linux`, at least one; each `{ executable, args: string[], configFiles?: [{path, format: ini|json|cfg|txt}] }`), `ports` (array of `{ name, default: 1–65535, protocol: udp|tcp }`, min 1). Optional: `$schema`, `gameAppId`, `saveDir`, `control` (`{ type: rcon|webrcon|rest|stdin|signal, save?, shutdown? }`), `players` (`{ source: rest|rcon|a2s|log }`), `bans` (`{ method: rest|rcon|file }`), `logPatterns` (`{ join?, leave? }`), `workshop` (null or object), `modLoaders` (array).

`palworld.json`: id `palworld`, serverAppId 2394010, gameAppId 1623730, anonymous true, tier `full`; linux executable `PalServer.sh`, windows `PalServer.exe`; args `["-port={port:game}", "-queryport={port:query}", "-useperfthreads", "-NoAsyncLoadingThread", "-UseMultithreadForDS"]`; ports game 8211/udp, query 27015/udp, rest 8212/tcp; configFiles `Pal/Saved/Config/LinuxServer/PalWorldSettings.ini` (linux) and `.../WindowsServer/...` (windows); saveDir `Pal/Saved/SaveGames`; control rest save/shutdown; players rest; bans rest.

- [ ] **Step 1: Write failing tests** in `catalog.test.ts` (each writes fixtures to a temp dir):
  - `loads a valid definition` → `games.length === 1`, `errors` empty.
  - `reports invalid JSON without throwing` → one valid + one `{bad` file: `games.length === 1`, `errors[0].file === 'bad.json'`.
  - `reports schema violations with the file name` → missing `serverAppId`: error message mentions `serverAppId`.
  - `rejects id that does not match filename` → `foo.json` with `id: "bar"`: rejected.
  - `rejects unsafe paths` → `it.each(['../x', '/etc/x', 'C:\\x', 'a/../../x', '\\\\server\\x'])` as executable: rejected.
  - `missing directory returns an error, not a throw` → `games: []`, `errors.length === 1`.
  - `every definition in games/ is valid` → `loadCatalog('games')` has no errors and includes `palworld`.
- [ ] **Step 2:** Run `npx vitest run` — Expected: FAIL (module not found).
- [ ] **Step 3:** Implement `loadCatalog` with Ajv 2020 compiling `games/schema.json` once; skip `schema.json` itself; a path is unsafe if `path.isAbsolute` (posix or win32), starts with `\\`, matches `^[A-Za-z]:`, or any `/`/`\` segment is `..`.
- [ ] **Step 4:** Run `npx vitest run` — Expected: all pass.
- [ ] **Step 5: Commit** `feat(core): game catalog schema and loader`.

### Task 3: Electron app shell

**Files:** Create `package.json`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`, `electron.vite.config.ts`, `electron-builder.yml`, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/src/{main.tsx,App.tsx,index.css,env.d.ts}`.

**Interfaces:**
- Consumes: `loadCatalog(dir)` from Task 2.
- Produces: IPC channel `catalog:list` → `{ games: GameDefinition[]; errors: CatalogError[] }`; preload exposes `window.neledport.listGames(): Promise<that>`.

- [ ] **Step 1:** Scripts: `dev` (electron-vite dev), `build` (electron-vite build), `typecheck` (`tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json`), `test` (vitest run), `dist` (build + electron-builder). Games dir = `app.isPackaged ? join(process.resourcesPath, 'games') : join(app.getAppPath(), 'games')`; electron-builder `extraResources: games`; targets nsis (win), AppImage + deb (linux).
- [ ] **Step 2:** UI: dark "control room" shell — left sidebar (logo "NeledPort", "Servers" section with empty state, "+ Add server" button disabled with tooltip "Coming in M1"), main area "Game catalog" grid of cards (cover from `https://cdn.cloudflare.steamstatic.com/steam/apps/{gameAppId}/header.jpg`, name, tier badge, App ID) and a visible error panel if `errors` is non-empty. CSP allows that image host only.
- [ ] **Step 3: Verify:** `npm run typecheck && npm test && npm run build` — Expected: all succeed. Then `npm run dev` and confirm the window shows the Palworld card (screenshot).
- [ ] **Step 4: Commit** `feat(app): electron shell with game catalog view`.

### Task 4: CI

**Files:** Create `.github/workflows/ci.yml`.

- [ ] **Step 1:** On push to `main` and PRs: matrix `ubuntu-latest`, `windows-latest`; `actions/checkout@v7`, `actions/setup-node@v7` (node 24, npm cache); `npm ci`, `npm run typecheck`, `npm test`, `npm run build`. `permissions: contents: read`.
- [ ] **Step 2: Commit** `ci: typecheck, test and build on Linux and Windows`.

### Task 5: Publish

- [ ] **Step 1:** `gh repo create NEXWEST-LEDGER-CORE/NeledPort --public --source . --push --description "<pitch>"` (run in the user's terminal; `gh` cannot verify TLS inside the sandbox).
- [ ] **Step 2:** Set topics (spec §8), enable Discussions, create labels `good first issue`, `help wanted`, `game-request`, `game-definition`.
- [ ] **Step 3: Verify:** `gh run watch` on the first CI run — Expected: both jobs green. Repo page shows MIT license and community profile files.
