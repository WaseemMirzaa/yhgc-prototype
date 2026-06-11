import { useEffect, useState } from "react"
import { HtmlLegalPreview } from "./HtmlLegalPreview"
import { loadMobileAppConfig, saveMobileAppConfig } from "../services/mobileAppConfigService"
import { defaultMobileAppConfig, type MobileAppConfig } from "../types/mobileAppConfig"

export function MobileAppSettingsPanel() {
  const [config, setConfig] = useState<MobileAppConfig>(defaultMobileAppConfig())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

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

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setNotice(null)
    try {
      await saveMobileAppConfig(config)
      setNotice("Mobile app settings saved.")
    } catch {
      setNotice("Could not save settings. Try again.")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p className="text-sm text-neutral-600">Loading mobile app settings…</p>
  }

  const origin = typeof window !== "undefined" ? window.location.origin : ""

  return (
    <form onSubmit={(e) => void handleSave(e)} className="space-y-6">
      <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-neutral-900">Mobile account creation</h3>
        <p className="mt-1 text-sm text-neutral-600">
          When disabled, the mobile app hides all self-signup UI. Toggle{" "}
          <code className="rounded bg-neutral-100 px-1">allowMobileSignup</code> in Firestore{" "}
          <code className="rounded bg-neutral-100 px-1">appConfig/mobile</code> or here.
        </p>
        <label className="mt-4 flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={config.allowMobileSignup}
            onChange={(e) => setConfig((c) => ({ ...c, allowMobileSignup: e.target.checked }))}
            className="h-4 w-4 rounded border-neutral-300"
          />
          <span className="text-sm font-medium text-neutral-800">Allow clients to create accounts from the mobile app</span>
        </label>
      </section>

      <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-neutral-900">Privacy policy (HTML)</h3>
        <p className="mt-1 text-sm text-neutral-600">
          Public page:{" "}
          <a className="text-yhgc-crimson underline" href={`${origin}${config.privacyPolicyPath}`} target="_blank" rel="noreferrer">
            {origin}
            {config.privacyPolicyPath}
          </a>
        </p>
        <div className="mt-4 grid gap-3">
          <label className="block text-sm">
            <span className="font-medium text-neutral-700">Path</span>
            <input
              className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2"
              value={config.privacyPolicyPath}
              onChange={(e) => setConfig((c) => ({ ...c, privacyPolicyPath: e.target.value }))}
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-neutral-700">Optional external URL (redirects instead of on-site HTML page)</span>
            <input
              className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2"
              value={config.privacyPolicyUrl ?? ""}
              onChange={(e) => setConfig((c) => ({ ...c, privacyPolicyUrl: e.target.value }))}
              placeholder="https://…"
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-neutral-700">Title</span>
            <input
              className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2"
              value={config.privacyPolicyTitle}
              onChange={(e) => setConfig((c) => ({ ...c, privacyPolicyTitle: e.target.value }))}
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-neutral-700">HTML content</span>
            <textarea
              className="mt-1 min-h-48 w-full rounded-lg border border-neutral-300 px-3 py-2 font-mono text-xs"
              value={config.privacyPolicyContent}
              onChange={(e) => setConfig((c) => ({ ...c, privacyPolicyContent: e.target.value }))}
              placeholder="<h2>Privacy Policy</h2><p>…</p>"
            />
          </label>
          <HtmlLegalPreview title="Preview" html={config.privacyPolicyContent} />
        </div>
      </section>

      <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-neutral-900">Terms of service (HTML)</h3>
        <p className="mt-1 text-sm text-neutral-600">
          Public page:{" "}
          <a className="text-yhgc-crimson underline" href={`${origin}${config.termsOfServicePath}`} target="_blank" rel="noreferrer">
            {origin}
            {config.termsOfServicePath}
          </a>
        </p>
        <div className="mt-4 grid gap-3">
          <label className="block text-sm">
            <span className="font-medium text-neutral-700">Path</span>
            <input
              className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2"
              value={config.termsOfServicePath}
              onChange={(e) => setConfig((c) => ({ ...c, termsOfServicePath: e.target.value }))}
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-neutral-700">Optional external URL</span>
            <input
              className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2"
              value={config.termsOfServiceUrl ?? ""}
              onChange={(e) => setConfig((c) => ({ ...c, termsOfServiceUrl: e.target.value }))}
              placeholder="https://…"
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-neutral-700">Title</span>
            <input
              className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2"
              value={config.termsOfServiceTitle}
              onChange={(e) => setConfig((c) => ({ ...c, termsOfServiceTitle: e.target.value }))}
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium text-neutral-700">HTML content</span>
            <textarea
              className="mt-1 min-h-48 w-full rounded-lg border border-neutral-300 px-3 py-2 font-mono text-xs"
              value={config.termsOfServiceContent}
              onChange={(e) => setConfig((c) => ({ ...c, termsOfServiceContent: e.target.value }))}
              placeholder="<h2>Terms of Service</h2><p>…</p>"
            />
          </label>
          <HtmlLegalPreview title="Preview" html={config.termsOfServiceContent} />
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-yhgc-crimson px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save mobile settings"}
        </button>
        {notice ? <p className="text-sm text-neutral-700">{notice}</p> : null}
      </div>
    </form>
  )
}
