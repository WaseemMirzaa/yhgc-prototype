import { createContext, useContext } from "react"
import type { Lang } from "./dictionary"

export type TranslateParams = Record<string, string | number>

export interface I18nContextValue {
  lang: Lang
  setLang: (lang: Lang) => void
  toggleLang: () => void
  /** Look up a key in the active language; falls back to French, then the key. `{name}` placeholders. */
  t: (key: string, params?: TranslateParams) => string
}

export const I18nContext = createContext<I18nContextValue | null>(null)

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error("useI18n must be used within I18nProvider")
  return ctx
}
