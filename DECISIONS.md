# Decisions

Significant choices, why we made them, and what we turned down. Newest first.

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
