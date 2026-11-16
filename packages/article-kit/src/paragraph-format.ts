/** An inline marker keeps the paragraph's Markdown (links, emphasis, etc.) intact. */
export const NO_INDENT_MARKER = `<span data-article-indent="none"></span>`

/** Resolve paragraph overrides after theme/component styling, before HTML is inlined. */
export function applyParagraphFormatting(html: string): string {
  if (!html.includes(`data-article-indent`))
    return html
  const root = document.createElement(`div`)
  root.innerHTML = html
  for (const marker of root.querySelectorAll<HTMLElement>(`span[data-article-indent="none"]`)) {
    if (marker.closest(`pre, code`))
      continue
    let paragraph = marker.closest('p')
    if (!paragraph && !marker.hasChildNodes()) {
      let next = marker.nextSibling
      while (next?.nodeType === Node.TEXT_NODE && !next.textContent?.trim())
        next = next.nextSibling
      if (next instanceof HTMLParagraphElement)
        paragraph = next
    }
    if (paragraph)
      paragraph.style.textIndent = `0`
    marker.replaceWith(...marker.childNodes)
  }
  return root.innerHTML
}
