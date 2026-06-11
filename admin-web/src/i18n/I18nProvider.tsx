import { useCallback, useMemo, useState, type ReactNode } from "react"
import { dictionaries, type Lang } from "./dictionary"
import { I18nContext, type I18nContextValue, type TranslateParams } from "./context"

const STORAGE_KEY = "yhgc-admin-lang"

function readInitialLang(): Lang {
  try {
    return localStorage.getItem(STORAGE_KEY) === "en" ? "en" : "fr"
  } catch {
    return "fr"
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readInitialLang)

  const setLang = useCallback((next: Lang) => {
    setLangState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // ignore storage failures (private mode, etc.)
    }
  }, [])

  const toggleLang = useCallback(() => setLang(lang === "en" ? "fr" : "en"), [lang, setLang])

  const t = useCallback(
    (key: string, params?: TranslateParams) => {
      let value = dictionaries[lang][key] ?? dictionaries.fr[key] ?? key
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          value = value.replaceAll(`{${k}}`, String(v))
        }
      }
      return value
    },
    [lang],
  )

  const value = useMemo<I18nContextValue>(() => ({ lang, setLang, toggleLang, t }), [lang, setLang, toggleLang, t])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
