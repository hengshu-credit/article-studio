import { prepareWeChatStructure } from './wechat-structure'

function isWechatLink(value: string): boolean {
  const href = value.trim()
  if (!/^(?:https?:)?\/\//i.test(href))
    return false
  try {
    const url = new URL(href.startsWith('//') ? `https:${href}` : href)
    return url.hostname === 'mp.weixin.qq.com'
  }
  catch {
    return false
  }
}

function externalWechatLinks(root: ParentNode) {
  return [...root.querySelectorAll('a, area')].filter(link =>
    ['href', 'xlink:href', 'data-href'].some((name) => {
      const value = link.getAttribute(name)
      return value !== null && !isWechatLink(value)
    }),
  )
}

/** Remove unsupported navigation while retaining the contents of linked text and images. */
export function prepareWechatHtml(html: string): string {
  const template = document.createElement('template')
  template.innerHTML = html
  const external = externalWechatLinks(template.content)
  if (!external.length)
    return html
  for (const link of external)
    link.replaceWith(...link.childNodes)
  return template.innerHTML
}

export function wrapArticleHtml(html: string, style: { fontFamily: string, fontSize: string, lineHeight: string, referenceTheme?: boolean }): string {
  const article = document.createElement(`section`)
  article.setAttribute(`data-article-kit`, `v1`)
  Object.assign(article.style, {
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    lineHeight: style.lineHeight,
    color: style.referenceTheme ? `#262626` : `#263445`,
    backgroundColor: `#ffffff`,
    textAlign: style.referenceTheme ? `justify` : `left`,
    overflowWrap: `break-word`,
    boxSizing: `border-box`,
    width: `100%`,
  })
  if (style.referenceTheme) {
    article.setAttribute(`data-article-preset`, `wechat-kaiti-red-v1`)
    article.style.padding = `0 10px`
    article.style.letterSpacing = `0.544px`
  }
  article.innerHTML = html
  prepareWeChatStructure(article, style.referenceTheme)
  // Native blockquotes, including imported HTML without editor classes,
  // gain a gray ::before in WeChat. Their theme is already inline here.
  for (const quote of article.querySelectorAll(`blockquote`)) {
    const section = document.createElement(`section`)
    for (const { name, value } of quote.attributes)
      section.setAttribute(name, value)
    section.setAttribute(`role`, `blockquote`)
    section.append(...quote.childNodes)
    quote.replaceWith(section)
  }
  return article.outerHTML
}

export function makeArticleDocument(title: string, html: string, bodyPadding = 16): string {
  const titleNode = document.createElement(`span`)
  titleNode.textContent = title
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data: blob:; style-src 'unsafe-inline'; font-src data:"><title>${titleNode.innerHTML}</title></head><body style="margin:0;padding:${bodyPadding}px;background:#fff;">${html}</body></html>`
}

export function inspectArticleHtml(html: string): string[] {
  const root = document.createElement(`div`)
  root.innerHTML = html
  const warnings: string[] = []
  if ([...root.querySelectorAll(`img`)].some(img => !/^https:\/\//i.test(img.getAttribute(`src`) || ``)))
    warnings.push(`包含本地、临时或内嵌图片。请在公众号草稿中确认图片已转存并能正常显示。`)
  if ([...root.querySelectorAll(`svg`)].some(svg => !svg.closest(`.mac-sign`)))
    warnings.push(`包含 SVG 图表或公式。公众号可能调整 SVG，请检查手机预览；必要时转为 PNG。`)
  if ([...root.querySelectorAll(`table`)].some(table => table.rows[0]?.cells.length > 4))
    warnings.push(`包含宽表格，请在手机预览检查；可拆表或导出为图片。`)
  if (/var\(--|color-mix\(/.test(html))
    warnings.push(`部分 CSS 仍使用变量或高级颜色语法，公众号可能改写，请核查自定义样式。`)
  if (externalWechatLinks(root).length)
    warnings.push(`包含外链。公众号对正文链接有限制，可开启引用模式或改用二维码。`)
  return warnings
}
