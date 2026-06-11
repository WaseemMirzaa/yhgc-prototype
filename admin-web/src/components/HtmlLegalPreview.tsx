type HtmlLegalPreviewProps = {
  html: string
  title?: string
}

export function HtmlLegalPreview({ html, title }: HtmlLegalPreviewProps) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
      {title ? <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{title}</p> : null}
      <div
        className="legal-html"
        dangerouslySetInnerHTML={{ __html: html || "<p><em>No content yet.</em></p>" }}
      />
    </div>
  )
}
