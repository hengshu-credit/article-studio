import type { ComponentTheme } from '@article-studio/article-kit'
import type { CustomComponentDef } from '@md/shared/types'
import { applyComponentTheme, componentPalette, decorateWeChatReference, DEFAULT_COMPONENT_THEME, WECHAT_REFERENCE_PRESET } from '@article-studio/article-kit'
import { initRenderer } from '@md/core/renderer'
import { postProcessHtml, renderMarkdown } from '@md/core/utils'
import { buildComponentSnippet } from '@/lib/component-snippet'

const picture = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120" viewBox="0 0 320 120"><rect width="320" height="120" fill="#eff4f3"/><path d="M24 93H296M24 24V93" stroke="#b2c6c0"/><path d="M40 76L88 52L132 64L188 34L236 45L280 23" fill="none" stroke="#387b70" stroke-width="3"/><rect x="42" y="57" width="20" height="36" fill="#bdd6cf"/><rect x="104" y="42" width="20" height="51" fill="#bdd6cf"/><rect x="166" y="55" width="20" height="38" fill="#bdd6cf"/><rect x="228" y="32" width="20" height="61" fill="#bdd6cf"/></svg>`)}`

/** Render the real template in a sandboxed document; never load a component's remote images. */
export function componentPreviewDocument(def: CustomComponentDef, theme: ComponentTheme = DEFAULT_COMPONENT_THEME): string {
  const renderer = initRenderer({ components: { [def.name]: def }, isMacCodeBlock: false })
  const { html, readingTime } = renderMarkdown(def.example || buildComponentSnippet(def), renderer)
  const root = document.createElement(`div`)
  root.innerHTML = applyComponentTheme(decorateWeChatReference(postProcessHtml(html, readingTime, renderer), theme.presetId === WECHAT_REFERENCE_PRESET), theme)
  const palette = componentPalette(theme)
  const themedPicture = picture.split(encodeURIComponent(`#387b70`)).join(encodeURIComponent(palette.accent)).split(encodeURIComponent(`#bdd6cf`)).join(encodeURIComponent(palette.border))
  root.querySelectorAll(`img`).forEach((img) => { img.src = themedPicture; img.removeAttribute(`srcset`) })
  root.querySelectorAll(`mp-common-profile`).forEach((card) => {
    const placeholder = document.createElement(`section`)
    Object.assign(placeholder.style, { padding: `18px`, border: `1px solid ${palette.border}`, background: palette.tint, color: palette.accent, fontWeight: `600` })
    placeholder.textContent = card.getAttribute(`data-nickname`) || `公众号名片`
    card.replaceWith(placeholder)
  })
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:"><style>:root{--md-primary-color:#245b83;--md-font-family:Arial,sans-serif;--md-font-size:14px;--md-line-height:1.7;--md-block-spacing:1}*{box-sizing:border-box}body{margin:0;padding:10px;background:#fff;color:#263445;font:14px/1.7 Arial,'Microsoft YaHei',sans-serif}body>div>.container>section:first-child{margin-top:0!important}p{margin:6px 0}h1,h2,h3{font-size:17px;margin:8px 0}img{max-width:100%;max-height:100px;object-fit:contain}table{width:100%;border-collapse:collapse}td,th{padding:5px;border:1px solid #dce4ed}a{color:#245b83}pre{white-space:pre-wrap}</style></head><body>${root.innerHTML}</body></html>`
}
