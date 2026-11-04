import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { thirdPartyLicenses } from './notices.mjs'

describe('thirdPartyLicenses', () => {
  const text = thirdPartyLicenses(join(import.meta.dirname, '..'))

  it('covers what the app and the CLI bundle, with the licence text', () => {
    for (const name of ['@modelcontextprotocol/server', 'zod', 'ajv', 'fast-uri', 'electron-updater', 'react', 'react-dom']) {
      expect(text).toMatch(new RegExp(`^${name} \\d`, 'm'))
    }
    expect(text).toMatch(/Permission is hereby granted/)
  })

  it('leaves out development tools', () => {
    expect(text).not.toMatch(/^vitest \d/m)
    expect(text).not.toMatch(/^electron \d/m)
  })
})
