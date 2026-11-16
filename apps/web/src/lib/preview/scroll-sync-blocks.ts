/** Position of a rendered top-level element inside the article container. */
export interface PreviewBlock {
  child: number
  line: number
}

export function markPreviewBlock(html: string, line: number): string {
  return html.replace(/^(\s*(?:<!--[\s\S]*?-->\s*)*<[\w-]+)(?=[\s/>])/, `$1 data-md-scroll-line="${line}"`)
}

/**
 * Resolve indices after sanitizing and theming (e.g. code frames). Keep all
 * scroll metadata out of the DOM used for copying, export and distribution.
 */
export function extractPreviewMap(html: string) {
  const template = document.createElement('template')
  template.innerHTML = html
  const blocks: PreviewBlock[] = []
  const container = template.content.firstElementChild
  if (container) {
    Array.from(container.children).forEach((el, child) => {
      const marker = el.hasAttribute('data-md-scroll-line') ? el : el.querySelector('[data-md-scroll-line]')
      if (marker)
        blocks.push({ child, line: Number(marker.getAttribute('data-md-scroll-line')) })
    })
  }
  for (const marker of template.content.querySelectorAll('[data-md-scroll-line]'))
    marker.removeAttribute('data-md-scroll-line')
  return { html: template.innerHTML, blocks }
}

export interface ScrollAnchor {
  editor: number
  preview: number
}

/**
 * Use only anchor pairs reachable in both panes; the last segment joins
 * the two actual scroll limits, even when one last viewport is much taller.
 */
export function mapScroll(top: number, from: keyof ScrollAnchor, end: ScrollAnchor, count: number, anchorAt: (index: number) => ScrollAnchor): number {
  const to = from === 'editor' ? 'preview' : 'editor'
  if (top <= 0 || end[from] <= 0)
    return 0
  if (top >= end[from] - 0.5)
    return end[to]
  let lo = 0
  let hi = count
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    const a = anchorAt(mid)
    if (a[from] <= top && a.editor < end.editor && a.preview < end.preview)
      lo = mid + 1
    else
      hi = mid
  }
  const left = lo ? anchorAt(lo - 1) : { editor: 0, preview: 0 }
  const next = lo < count ? anchorAt(lo) : undefined
  const right = next && next.editor < end.editor && next.preview < end.preview ? next : end
  return left[to] + (right[to] - left[to]) * (top - left[from]) / (right[from] - left[from])
}
