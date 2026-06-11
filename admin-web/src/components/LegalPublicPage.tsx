import { useEffect, useState } from "react"
import { loadMobileAppConfig } from "../services/mobileAppConfigService"
import type { MobileAppConfig } from "../types/mobileAppConfig"

const BRAND_LOGO_SRC = "/yhgc-logo.png"

type LegalKind = "privacy" | "terms"

function resolveLegal(config: MobileAppConfig, kind: LegalKind) {
  if (kind === "privacy") {
    return {
      title: config.privacyPolicyTitle,
      content: config.privacyPolicyContent,
      externalUrl: config.privacyPolicyUrl?.trim() || "",
    }
  }
  return {
    title: config.termsOfServiceTitle,
    content: config.termsOfServiceContent,
    externalUrl: config.termsOfServiceUrl?.trim() || "",
  }
}

export function LegalPublicPage({ kind }: { kind: LegalKind }) {
  const [config, setConfig] = useState<MobileAppConfig | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const loaded = await loadMobileAppConfig()
        if (!cancelled) setConfig(loaded)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!config) return
    const legal = resolveLegal(config, kind)
    if (legal.externalUrl) window.location.replace(legal.externalUrl)
  }, [config, kind])

  if (loading || !config) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-100 text-sm text-neutral-600">
        Loading…
      </div>
    )
  }

  const legal = resolveLegal(config, kind)
  if (legal.externalUrl) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-100 text-sm text-neutral-600">
        Redirecting…
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f8f6f2] to-[#eef1f5]">
      <header className="border-b border-yhgc-gold/25 bg-gradient-to-r from-[#090909] to-[#1a1a1a] px-6 py-5 text-white">
        <div className="mx-auto flex max-w-3xl items-center gap-4">
          <img src={BRAND_LOGO_SRC} alt="" className="h-9 w-auto object-contain" />
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-yhgc-gold">YHGC Client</p>
            <h1 className="text-xl font-semibold">{legal.title}</h1>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-8">
        <article className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
          <div className="legal-html" dangerouslySetInnerHTML={{ __html: legal.content }} />
        </article>
        <p className="mt-6 text-center text-xs text-neutral-500">
          Last updated {new Date(config.updatedAt).toLocaleString("en-GB")}
        </p>
      </main>
    </div>
  )
}
