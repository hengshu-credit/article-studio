import { applyParagraphFormatting } from './paragraph-format'

export interface ComponentTheme {
  primaryColor: string
  fontFamily: string
  fontSize: string
  lineHeight: string
  presetId?: string
}

export const DEFAULT_COMPONENT_THEME: ComponentTheme = {
  primaryColor: `#245b83`,
  fontFamily: `Arial, 'Microsoft YaHei', sans-serif`,
  fontSize: `16px`,
  lineHeight: `1.75`,
}

export function componentPalette(theme: ComponentTheme) {
  const raw = theme.primaryColor.replace(/^#/, ``)
  const hex = raw.length === 3 || raw.length === 4 ? [...raw].map(char => char + char).join(``) : raw
  const parsed = /^[\da-f]{6}(?:[\da-f]{2})?$/i.test(hex)
    ? [0, 2, 4].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16))
    : /^rgba?\(/i.test(theme.primaryColor) ? theme.primaryColor.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [] : []
  const rgb = parsed.length === 3 ? parsed.map(channel => Math.min(255, Math.max(0, channel))) : [36, 91, 131]
  const mix = (weight: number) => `rgb(${rgb.map(channel => Math.round(channel * weight + 255 * (1 - weight))).join(`, `)})`
  const alpha = (opacity: number) => `rgba(${rgb.join(`, `)}, ${opacity})`
  const lightAccent = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 > 170
  return {
    accent: `rgb(${rgb.join(`, `)})`,
    onAccent: lightAccent ? `#263445` : `#ffffff`,
    tint: mix(0.07),
    border: mix(0.25),
    text: `#263445`,
    muted: `#64748b`,
    quoteTint: alpha(0.12),
    codeShadow: alpha(0.28),
    scrollbarThumb: alpha(0.65),
    scrollbarHover: alpha(0.9),
    scrollbarTrack: alpha(0.08),
  }
}

/** One inline styling contract for live articles, thumbnails and delivery HTML. */
export function applyComponentTheme(html: string, theme: ComponentTheme): string {
  if (!html.includes(`data-md-component=`))
    return applyParagraphFormatting(html)
  const container = document.createElement(`div`)
  container.innerHTML = html
  const palette = componentPalette(theme)
  const variables: Record<string, string> = {
    '--md-comp-bg': `#ffffff`,
    '--md-comp-bg-secondary': palette.tint,
    '--md-comp-bg-stripe': palette.tint,
    '--md-comp-text-primary': palette.text,
    '--md-comp-text-secondary': palette.muted,
    '--md-comp-text-tertiary': palette.muted,
    '--md-comp-border-default': palette.border,
    '--md-comp-border-light': palette.border,
  }
  const size = Number.parseFloat(theme.fontSize) || 16
  const small = `${Math.round(size * 0.82 * 100) / 100}px`
  const paint = (element: HTMLElement | undefined | null, styles: Partial<CSSStyleDeclaration>) => {
    if (element)
      Object.assign(element.style, styles)
  }
  const paintReportImage = (root: HTMLElement) => {
    paint(root.querySelector(`[data-wechat-figure-frame]`), { margin: `0 3px`, padding: `0`, lineHeight: `0`, background: `transparent`, border: `0` })
    paint(root.querySelector(`img`), { display: `block`, width: `100%`, maxWidth: `100%`, height: `auto`, maxHeight: `none`, margin: `0`, boxSizing: `border-box`, border: `1px solid #dedede`, boxShadow: `0 0 5px rgba(0, 0, 0, 0.18)` })
  }
  const paintBanner = (banner: HTMLElement | null) => {
    paint(banner, { border: `0`, background: palette.accent, color: palette.onAccent, padding: `2px 8px`, fontSize: `${Math.round(size * 0.86)}px`, lineHeight: `1.6`, textAlign: `center`, textIndent: `0`, letterSpacing: `1px`, overflowWrap: `anywhere` })
  }
  for (const root of container.querySelectorAll<HTMLElement>(`[data-md-component]`)) {
    const name = root.getAttribute(`data-md-component`)
    for (const element of [root, ...root.querySelectorAll<HTMLElement>(`*`)]) {
      if (!element.style || element.namespaceURI?.includes(`svg`) || element.closest(`.mac-sign`))
        continue
      const inlineStyle = element.getAttribute(`style`)
      if (inlineStyle?.includes(`var(--md-comp`))
        element.setAttribute(`style`, inlineStyle.replace(/var\(\s*(--md-comp[\w-]+)\s*(?:,([^)]*))?\)/g, (_match, key: string, fallback: string) => variables[key] ?? fallback?.trim() ?? `inherit`))
      paint(element, { borderRadius: `0`, boxShadow: `none`, textShadow: `none` })
      if (element.closest(`pre,code`))
        continue
      if (element.style.backgroundColor || element.style.backgroundImage)
        paint(element, { background: palette.tint })
      if (element.style.border || element.style.borderColor || element.style.borderBottom || element.style.borderTop || element.style.borderLeft || element.style.borderRight)
        element.style.borderColor = palette.border
      element.style.color = `inherit`
      paint(element, { fontFamily: `inherit`, fontSize: `inherit`, lineHeight: `inherit` })
      if (element.tagName === `P`)
        paint(element, { margin: `0 0 8px`, padding: `0`, textIndent: `0`, textAlign: `inherit`, color: `inherit`, letterSpacing: `inherit` })
    }
    paint(root, { fontFamily: theme.fontFamily, fontSize: theme.fontSize, lineHeight: theme.lineHeight, color: palette.text, margin: `20px 0`, padding: `16px`, background: `#ffffff`, border: `1px solid ${palette.border}`, boxSizing: `border-box`, textIndent: `0`, letterSpacing: `0.2px` })
    const paragraphs = [...root.querySelectorAll<HTMLElement>(`p`)]
    paint(paragraphs[paragraphs.length - 1], { marginBottom: `0` })
    paint(paragraphs[0], { color: palette.accent, fontWeight: `600` })
    root.querySelectorAll<HTMLElement>(`a`).forEach(link => paint(link, { color: palette.accent, textDecoration: `underline` }))

    if ([`ArticleLeadV1`, `KeyFindingV1`, `MethodNoteV1`, `TipBlock`].includes(name || ``)) {
      paint(root, { background: palette.tint })
      if (name === `ArticleLeadV1`)
        root.style.borderTop = `3px solid ${palette.accent}`
      else
        paint(root, { border: `0`, borderLeft: `3px solid ${palette.accent}` })
    }
    if (name === `MetricCardV1`) {
      paint(paragraphs[0], { color: palette.muted, fontSize: small, fontWeight: `400` })
      paint(paragraphs[1], { color: palette.accent, fontSize: `${size * 1.875}px`, lineHeight: `1.3`, fontWeight: `700` })
      paint(paragraphs[2], { color: palette.muted, fontSize: small })
    }
    if (name === `WeChatIntroV1`) {
      paint(root, { border: `0`, padding: `0` })
      const header = root.firstElementChild as HTMLElement
      paint(header, { background: palette.accent, height: `auto`, lineHeight: `1.4` })
      paint(header?.firstElementChild as HTMLElement, { background: `#ffffff`, color: palette.accent, fontWeight: `600`, paddingRight: `8px` })
      paint(root.querySelector(`[data-wechat-intro-body]`), { background: palette.tint, padding: `14px 16px`, textAlign: `left` })
      paint(paragraphs[0], { color: palette.text, fontWeight: `400` })
    }
    if (name === `WeChatBannerV1`)
      paintBanner(root)
    if (name === `WeChatFigureBannerV1`) {
      paint(root, { border: `0`, padding: `0`, background: `transparent` })
      paintReportImage(root)
      const banner = root.querySelector<HTMLElement>(`[data-wechat-figure-banner]`)
      paintBanner(banner)
      paint(banner, { margin: `4px 0 0` })
    }
    if (name === `WeChatHighlightV1`) {
      paint(root, { border: `0`, borderLeft: `3px solid ${palette.accent}`, background: palette.tint, color: palette.accent })
      paragraphs.forEach(p => paint(p, { fontWeight: `400` }))
    }
    if ([`FigureCaptionV1`, `WeChatFigureV1`, `ArticleFooterV1`].includes(name || ``)) {
      paint(root, { border: `0`, padding: `0`, background: `transparent` })
      paragraphs.forEach(p => paint(p, { color: palette.muted, fontSize: small, fontWeight: `400` }))
      if (name === `ArticleFooterV1`) {
        paint(root, { borderTop: `1px solid ${palette.border}`, paddingTop: `16px`, marginTop: `28px` })
        paint(paragraphs[0], { color: palette.accent, fontWeight: `600` })
      }
      if (name === `WeChatFigureV1`) {
        paintReportImage(root)
        paragraphs.forEach(p => paint(p, { margin: `8px 0 0` }))
      }
    }
    if (name === `AuthorBlock`) {
      paint(paragraphs[0], { color: palette.accent, fontWeight: `600` })
      paint(paragraphs[1], { color: palette.muted, fontSize: small })
    }
    if (name === `QRCodeBlock`)
      paragraphs.forEach(p => paint(p, { fontSize: small, color: palette.muted, fontWeight: `400` }))
    if (name === `TableBlock`) {
      paint(root, { border: `0`, padding: `0` })
      root.querySelectorAll<HTMLElement>(`th`).forEach(cell => paint(cell, { background: palette.accent, color: palette.onAccent, border: `1px solid ${palette.border}`, padding: `8px` }))
      root.querySelectorAll<HTMLElement>(`td`).forEach(cell => paint(cell, { color: palette.text, border: `1px solid ${palette.border}`, padding: `8px` }))
      root.querySelectorAll<HTMLElement>(`tbody tr`).forEach((row, index) => paint(row, { background: index % 2 ? palette.tint : `#ffffff` }))
    }
    if (name === `InfoGrid`) {
      paint(root, { padding: `0` })
      root.querySelectorAll<HTMLElement>(`section[style*="table-cell"]`).forEach((cell) => {
        paint(cell.firstElementChild as HTMLElement, { color: palette.muted, fontSize: small })
        paint(cell.lastElementChild as HTMLElement, { color: palette.accent, fontWeight: `600` })
      })
    }
    if (name === `BadgeGroup`) {
      paint(root, { border: `0`, padding: `0`, background: `transparent` })
      root.querySelectorAll<HTMLElement>(`span`).forEach(badge => paint(badge, { background: palette.tint, color: palette.accent, border: `1px solid ${palette.border}`, padding: `4px 8px`, fontSize: small }))
    }
  }
  // Existing articles can keep the two v1 tags: adjacent figure/banner blocks
  // use the same compact seam as the combined component, before CSS inlining.
  for (const figure of container.querySelectorAll<HTMLElement>(`[data-md-component="WeChatFigureV1"]`)) {
    let next = figure.nextSibling
    while (next?.nodeType === Node.TEXT_NODE && !next.textContent?.trim())
      next = next.nextSibling
    if (next instanceof HTMLElement && next.getAttribute(`data-md-component`) === `WeChatBannerV1`) {
      figure.style.marginBottom = `4px`
      next.style.marginTop = `0`
    }
  }
  return applyParagraphFormatting(container.innerHTML)
}
