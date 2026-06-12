import { useCallback, useMemo, type ReactNode } from "react"
import { dictionaries } from "./dictionary"
import { I18nContext, type I18nContextValue, type TranslateParams } from "./context"

const lang = "en" as const

export function I18nProvider({ children }: { children: ReactNode }) {
  const t = useCallback(
    (key: string, params?: TranslateParams) => {
      let value = dictionaries[lang][key] ?? dictionaries.en[key] ?? key
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          value = value.replaceAll(`{${k}}`, String(v))
        }
      }
      return value
    },
    [],
  )

  const value = useMemo<I18nContextValue>(
    () => ({
      lang,
      setLang: () => {},
      toggleLang: () => {},
      t,
    }),
    [t],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
