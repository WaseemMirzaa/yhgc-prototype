import { useState, type FormEvent } from "react"
import { deleteClientAccountWithCredentials } from "../services/clientAccountDeletionService"

const BRAND_LOGO_SRC = "/yhgc-logo.png"

export function DeleteAccountPublicPage() {
  const [loginCode, setLoginCode] = useState("")
  const [password, setPassword] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (!loginCode.trim()) {
      setError("Enter your login code.")
      return
    }
    if (!password) {
      setError("Enter your password.")
      return
    }
    if (!confirmed) {
      setError("Confirm that you understand this action cannot be undone.")
      return
    }

    setSubmitting(true)
    try {
      const result = await deleteClientAccountWithCredentials({ loginCode, password })
      if (!result.ok) {
        setError(result.message)
        return
      }
      setSuccess(true)
      setLoginCode("")
      setPassword("")
      setConfirmed(false)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f8f6f2] to-[#eef1f5]">
      <header className="border-b border-yhgc-gold/25 bg-gradient-to-r from-[#090909] to-[#1a1a1a] px-6 py-5 text-white">
        <div className="mx-auto flex max-w-lg items-center gap-4">
          <img src={BRAND_LOGO_SRC} alt="" className="h-9 w-auto object-contain" />
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-yhgc-gold">YHGC Client</p>
            <h1 className="text-xl font-semibold">Delete account</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-lg px-6 py-8">
        <article className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
          {success ? (
            <div className="space-y-3 text-sm text-neutral-700">
              <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 font-medium text-emerald-900">
                Your mobile app account access has been removed.
              </p>
              <p>
                Portfolio records managed by your adviser may remain on file. You can close this page. If you use the
                YHGC app on a device, log out or uninstall it.
              </p>
            </div>
          ) : (
            <>
              <p className="text-sm leading-relaxed text-neutral-600">
                Enter your <strong>login code</strong> and <strong>password</strong> to permanently remove your mobile
                app access. This cannot be undone.
              </p>

              <form onSubmit={(e) => void handleSubmit(e)} className="mt-5 space-y-4">
                <label className="block text-sm">
                  <span className="font-medium text-neutral-800">Login code</span>
                  <input
                    type="text"
                    value={loginCode}
                    onChange={(e) => setLoginCode(e.target.value)}
                    autoComplete="username"
                    className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2.5 outline-none focus:border-yhgc-gold focus:ring-2 focus:ring-yhgc-gold/20"
                    placeholder="YHG-2026-1001"
                  />
                </label>

                <label className="block text-sm">
                  <span className="font-medium text-neutral-800">Password</span>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2.5 outline-none focus:border-yhgc-gold focus:ring-2 focus:ring-yhgc-gold/20"
                  />
                </label>

                <label className="flex cursor-pointer items-start gap-3 text-sm text-neutral-700">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-neutral-300"
                  />
                  <span>
                    I understand this removes my app login and push notification access. Portfolio data held by my
                    adviser may remain on file.
                  </span>
                </label>

                {error ? (
                  <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                    {error}
                  </p>
                ) : null}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-lg bg-yhgc-crimson px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {submitting ? "Deleting…" : "Delete my account"}
                </button>
              </form>
            </>
          )}
        </article>

        <p className="mt-6 text-center text-xs text-neutral-500">
          Need help? Contact{" "}
          <a className="text-yhgc-crimson underline" href="mailto:admin@yourhomegroupconsultancy.co.uk">
            admin@yourhomegroupconsultancy.co.uk
          </a>
        </p>
      </main>
    </div>
  )
}
