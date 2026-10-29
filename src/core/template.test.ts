import { describe, expect, it } from 'vitest'
import { expand, placeholders } from './template'

const ctx = { ports: { game: 2456 }, settings: { name: 'My Server' }, installDir: '/srv/valheim' }

describe('expand', () => {
  it('replaces ports, settings and installDir', () => {
    expect(expand('-port={port:game}', ctx)).toBe('-port=2456')
    expect(expand('{setting:name}', ctx)).toBe('My Server')
    expect(expand('{installDir}/saves', ctx)).toBe('/srv/valheim/saves')
  })

  it('leaves text without placeholders alone', () => {
    expect(expand('-nographics', ctx)).toBe('-nographics')
  })

  it('throws on an unknown placeholder', () => {
    expect(() => expand('{port:query}', ctx)).toThrow(/port:query/)
    expect(() => expand('{whatever}', ctx)).toThrow(/whatever/)
  })

  it('does not re-expand values that contain braces', () => {
    const tricky = { ...ctx, settings: { name: '{installDir}' } }
    expect(expand('{setting:name}', tricky)).toBe('{installDir}')
  })
})

describe('placeholders', () => {
  it('lists every placeholder in a string', () => {
    expect(placeholders('-a={port:game} -b={setting:name} {installDir}')).toEqual([
      'port:game',
      'setting:name',
      'installDir'
    ])
  })
})
