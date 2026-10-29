import en from './locales/en.json'
import th from './locales/th.json'

export type MessageKey = keyof typeof en
type Messages = Partial<Record<MessageKey, string>>

/**
 * English is the source language and always complete. Other languages may be partial:
 * a missing string falls back to English, so a new translation can ship before it is finished.
 * To add a language, add locales/<code>.json and list it here.
 */
export const dictionaries: Record<string, Messages> = { en, th }
export const languages = Object.keys(dictionaries)
export const isLanguage = (value: unknown): value is string => typeof value === 'string' && languages.includes(value)

export function translate(lang: string, key: MessageKey, vars?: Record<string, string | number>): string {
  const text = dictionaries[lang]?.[key] ?? en[key]
  if (!vars) return text
  // Only {word} placeholders; game template syntax such as {port:game} is left as written.
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (Object.hasOwn(vars, name) ? String(vars[name]) : match))
}

/** First supported language from a preference list such as navigator.languages ('th-TH' → 'th'). */
export function pickLanguage(preferred: readonly string[]): string {
  for (const tag of preferred) {
    const lower = tag.toLowerCase()
    const match = languages.find((l) => l.toLowerCase() === lower) ?? languages.find((l) => l.toLowerCase() === lower.split('-')[0])
    if (match) return match
  }
  return 'en'
}
