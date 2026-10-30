import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { installedBuild, parseLatestBuild } from './build'

const MANIFEST = `"AppState"
{
	"appid"		"896660"
	"name"		"Valheim Dedicated Server"
	"buildid"		"20345678"
	"LastUpdated"		"1761700000"
}`

const APP_INFO = `"896660"
{
	"common" { "name" "Valheim Dedicated Server" }
	"depots"
	{
		"branches"
		{
			"public"
			{
				"buildid"		"20400000"
				"timeupdated"		"1761800000"
			}
			"public-test"
			{
				"buildid"		"20500000"
			}
		}
	}
}`

describe('installedBuild', () => {
  it('reads the build id from the app manifest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'build-'))
    mkdirSync(join(dir, 'steamapps'))
    writeFileSync(join(dir, 'steamapps', 'appmanifest_896660.acf'), MANIFEST)
    expect(installedBuild(dir, 896660)).toBe('20345678')
  })

  it('returns undefined when not installed', () => {
    expect(installedBuild(join(tmpdir(), 'missing-neledport'), 1)).toBeUndefined()
  })
})

describe('parseLatestBuild', () => {
  it('reads the public branch build, not other branches', () => {
    expect(parseLatestBuild(APP_INFO)).toBe('20400000')
  })

  it('reads the beta branch a game installs from', () => {
    expect(parseLatestBuild(APP_INFO, 'public-test')).toBe('20500000')
  })

  it('returns undefined when the output has no branch info', () => {
    expect(parseLatestBuild('No app info for AppID 1 found')).toBeUndefined()
  })
})
