import { describe, expect, it } from 'vitest'
import { dictionaries, isLanguage, languages, pickLanguage, translate } from './i18n'

const en = dictionaries.en as Record<string, string>
const vars = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe('translations', () => {
  it.each(languages)('%s only uses keys that English has', (lang) => {
    const extra = Object.keys(dictionaries[lang]).filter((k) => !(k in en))
    expect(extra).toEqual([])
  })

  it.each(languages)('%s keeps the {placeholders} of every English string', (lang) => {
    for (const [key, text] of Object.entries(dictionaries[lang])) expect(vars(text!), `${lang}: ${key}`).toEqual(vars(en[key]))
  })

  it.each(languages)('%s has no empty strings and names itself', (lang) => {
    for (const [key, text] of Object.entries(dictionaries[lang])) expect(text!.trim(), `${lang}: ${key}`).not.toBe('')
    expect(dictionaries[lang]['language.name']).toBeTruthy()
  })
})

describe('translate', () => {
  it('fills placeholders and leaves template syntax alone', () => {
    expect(translate('en', 'catalog.noMatch', { query: 'zom' })).toContain('“zom”')
    expect(translate('en', 'launch.argsLabel')).toContain('{port:game}')
  })

  it('falls back to English for an unknown language', () => {
    expect(translate('xx', 'sidebar.addServer')).toBe(en['sidebar.addServer'])
  })

  it('speaks Thai', () => {
    expect(translate('th', 'sidebar.addServer')).not.toBe(en['sidebar.addServer'])
  })
})

describe('pickLanguage', () => {
  it('matches the system language by its base code', () => {
    expect(pickLanguage(['th-TH'])).toBe('th')
    expect(pickLanguage(['TH'])).toBe('th')
  })

  it('takes the first supported language in order of preference', () => {
    expect(pickLanguage(['xx-YY', 'th', 'en'])).toBe('th')
  })

  it('defaults to English', () => {
    expect(pickLanguage(['xx-YY'])).toBe('en')
    expect(pickLanguage([])).toBe('en')
  })

  it('never treats object built-ins as languages', () => {
    expect(pickLanguage(['constructor', 'toString'])).toBe('en')
    expect(isLanguage('constructor')).toBe(false)
    expect(isLanguage('th')).toBe(true)
  })
})
