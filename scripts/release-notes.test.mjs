import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { releaseNotes } from './release-notes.mjs'

const CHANGELOG = `# Changelog

## [Unreleased]

## [0.2.0] - 2026-10-30

### Added

- **Backups tab:** restore in a click.

### Fixed

- SteamCMD stops when NeledPort quits.

## [0.1.0] - 2026-10-29

### Added

- First release.

[Unreleased]: https://example.com/compare/v0.2.0...HEAD
[0.2.0]: https://example.com/compare/v0.1.0...v0.2.0
[0.1.0]: https://example.com/releases/tag/v0.1.0
`

describe('releaseNotes', () => {
  it("returns only that version's section, with a link to every change", () => {
    expect(releaseNotes(CHANGELOG, '0.2.0')).toBe(
      '### Added\n\n- **Backups tab:** restore in a click.\n\n### Fixed\n\n- SteamCMD stops when NeledPort quits.\n\n' +
        '**Full changelog:** https://example.com/compare/v0.1.0...v0.2.0\n'
    )
  })

  it('stops before the link list for the oldest version', () => {
    expect(releaseNotes(CHANGELOG, '0.1.0')).toBe('### Added\n\n- First release.\n\n**Full changelog:** https://example.com/releases/tag/v0.1.0\n')
  })

  it('refuses a version with no notes, so a release cannot ship without them', () => {
    expect(() => releaseNotes(CHANGELOG, '0.3.0')).toThrow(/No CHANGELOG notes for 0.3.0/)
    expect(() => releaseNotes(CHANGELOG.replace('- First release.\n', ''), '0.1.0')).toThrow(/No CHANGELOG notes for 0.1.0/)
  })

  it('has notes for every version in the real CHANGELOG', () => {
    const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
    const versions = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map((m) => m[1])
    expect(versions.length).toBeGreaterThan(0)
    for (const v of versions) expect(releaseNotes(changelog, v)).toMatch(/^### /)
  })
})
