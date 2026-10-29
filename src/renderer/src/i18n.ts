import { useSyncExternalStore } from 'react'
import { isLanguage, pickLanguage, translate, type MessageKey } from '../../core/i18n'

export type T = (key: MessageKey, vars?: Record<string, string | number>) => string

const STORAGE_KEY = 'neledport.language'
const listeners = new Set<() => void>()
let current = 'en'

function apply(lang: string): void {
  current = lang
  document.documentElement.lang = lang
  // The main process uses it for native dialogs (quit prompt, file pickers).
  void window.neledport.setLanguage(lang)
  listeners.forEach((l) => l())
}

function saved(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function setLanguage(lang: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang)
  } catch {
    // Storage unavailable: the choice still holds until the app closes.
  }
  apply(lang)
}

const stored = saved()
apply(isLanguage(stored) ? stored : pickLanguage(navigator.languages))

export function useLanguage(): string {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => current
  )
}

export function useT(): T {
  const lang = useLanguage()
  return (key, vars) => translate(lang, key, vars)
}
