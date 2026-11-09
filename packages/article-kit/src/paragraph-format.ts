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
    const paragraph = marker.closest(`p`)
    if (paragraph)
      paragraph.style.textIndent = `0`
    marker.replaceWith(...marker.childNodes)
  }
  return root.innerHTML
}
