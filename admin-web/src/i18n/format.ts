/** fr-FR locale formatting for the admin. Currency is the euro (the business currency). */

export function formatEuro(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return "—"
  try {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    }).format(n)
  } catch {
    return `${n} €`
  }
}

export function formatDateFr(iso: string | undefined | null): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  try {
    return new Intl.DateTimeFormat("fr-FR").format(d)
  } catch {
    return String(iso)
  }
}
