import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
// @vitest-environment jsdom
import { ARTICLE_COMPONENTS, decorateWeChatReference, WECHAT_REFERENCE_FONT, WECHAT_REFERENCE_SOURCE } from '@article-studio/article-kit'
import referenceMarkdown from '@article-studio/article-kit/wechat-reference.md?raw'
import { initRenderer } from '@md/core/renderer'
import { applyTheme } from '@md/core/theme'
import { postProcessHtml, renderMarkdown } from '@md/core/utils'
import juice from 'juice'
import { describe, expect, it } from 'vitest'
import { getStylesToAdd } from '@/services/export/share-styles'
import { wrapArticleHtml } from './artifact-html'

// Vitest stubs CSS modules by default; read the shipped styles for inlining assertions.
const referenceCSS = readFileSync(resolve(process.cwd(), `../../packages/article-kit/styles/wechat-kaiti-red-v1.css`), `utf8`)
const codeCSS = readFileSync(resolve(process.cwd(), `node_modules/highlight.js/styles/atom-one-light.css`), `utf8`)

function render(markdown: string, reference = true): string {
  const renderer = initRenderer({ components: Object.fromEntries(ARTICLE_COMPONENTS.map(component => [component.name, component])), isMacCodeBlock: true })
  const { html, readingTime } = renderMarkdown(markdown, renderer)
  return decorateWeChatReference(postProcessHtml(html, readingTime, renderer), reference)
}

describe(`weChat reference theme`, () => {
  it(`turns chapter and subsection numbers into real nodes, resetting subsections per chapter`, () => {
    const root = document.createElement(`div`)
    root.innerHTML = render(`## 概览\n\n### 数据\n\n### 检查\n\n## 实验\n\n### 结果`)
    expect([...root.querySelectorAll(`.wechat-chapter .wechat-heading-number`)].map(el => el.textContent)).toEqual([`零`, `一`])
    expect([...root.querySelectorAll(`.wechat-subsection .wechat-heading-number`)].map(el => el.textContent)).toEqual([`01`, `02`, `01`])
    expect(root.querySelectorAll(`[data-heading]`)).toHaveLength(5)
    expect(render(`## 普通主题`, false)).not.toContain(`wechat-chapter`)
  })

  it(`keeps explicit numbering and heading markup while escaping heading text`, () => {
    const root = document.createElement(`div`)
    root.innerHTML = render(`## 三 **检查**\n\n### 05 [方法](https://example.com)\n\n## &lt;img src=x onerror=alert(1)&gt;`)
    expect(root.querySelector(`.wechat-heading-number`)?.textContent).toBe(`三`)
    expect(root.querySelector(`.wechat-heading-label strong`)?.textContent).toBe(`检查`)
    expect(root.querySelector(`.wechat-subsection a`)?.textContent).toBe(`方法`)
    expect(root.querySelector(`img`)).toBeNull()
    expect(root.textContent).toContain(`<img`)
  })

  it(`renders standalone intro typography and local Mac dots without a remote background image`, () => {
    const root = document.createElement(`div`)
    root.innerHTML = render(`<WeChatIntroV1>\n\n引言 **示例**。\n\n</WeChatIntroV1>\n\n\`\`\`python\nprint("demo")\n\`\`\``)
    const intro = root.querySelector<HTMLElement>(`[data-wechat-intro-body] p`)!
    expect(intro.style.fontSize).toBe(`14px`)
    expect(intro.style.lineHeight).toBe(`1.75`)
    expect(intro.querySelector(`strong`)).not.toBeNull()
    expect(root.querySelectorAll(`.mac-sign > span`)).toHaveLength(3)
    expect(root.querySelector(`.mac-sign svg`)).toBeNull()
    expect(root.innerHTML).not.toContain(`url(`)
  })

  it(`inlines the observed typography, red title geometry and light code style with the production theme pipeline`, async () => {
    await applyTheme({
      themeName: `default`,
      customCSS: referenceCSS,
      variables: { primaryColor: `#c00000`, fontFamily: WECHAT_REFERENCE_FONT, fontSize: `14px`, lineHeight: `1.6` },
    })
    const html = render(referenceMarkdown)
    const css = await getStylesToAdd()
    const inlined = juice(`${css}<style>${codeCSS}</style>${html}`, { inlinePseudoElements: true, preserveImportant: true })
    const root = document.createElement(`div`)
    root.innerHTML = wrapArticleHtml(inlined, { fontFamily: WECHAT_REFERENCE_FONT, fontSize: `14px`, lineHeight: `1.6`, referenceTheme: true })
    const badge = root.querySelector<HTMLElement>(`.wechat-chapter .wechat-heading-number`)!
    expect(badge.style.backgroundColor).toBe(`rgb(192, 0, 0)`)
    expect(badge.style.width || badge.style.flexBasis).toBe(`25px`)
    const paragraph = [...root.querySelectorAll<HTMLElement>(`p`)].find(p => p.textContent?.startsWith(`数据分析首先`))!
    expect(paragraph.style.fontSize).toBe(WECHAT_REFERENCE_SOURCE.bodyFontSize)
    expect(paragraph.style.textIndent).toBe(`34px`)
    expect(paragraph.style.lineHeight).toBe(`1.6`)
    const pre = root.querySelector<HTMLElement>(`pre`)!
    const code = pre.querySelector<HTMLElement>(`code`)!
    expect(pre.style.backgroundColor).toBe(`rgb(250, 250, 250)`)
    expect(pre.style.boxShadow).toContain(`0.55`)
    expect(code.style.fontSize).toBe(`12px`)
    expect(code.style.lineHeight).toBe(`26px`)
    expect(root.querySelector(`style, link`)).toBeNull()
    expect(root.innerHTML).not.toMatch(/var\(--|color-mix\(/)
    expect(root.textContent).toContain(`pd.cut`)
  })
})
