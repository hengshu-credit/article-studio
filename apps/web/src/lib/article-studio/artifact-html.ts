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
  if (root.querySelector(`a[href^="http"]`))
    warnings.push(`包含外链。公众号对正文链接有限制，可开启引用模式或改用二维码。`)
  return warnings
}
