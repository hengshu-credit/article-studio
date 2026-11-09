import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
// @vitest-environment jsdom
import { ARTICLE_COMPONENTS, componentPalette, decorateWeChatReference, WECHAT_REFERENCE_FONT, WECHAT_REFERENCE_SOURCE } from '@article-studio/article-kit'
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
const articleCodeCSS = readFileSync(resolve(process.cwd(), `../../packages/article-kit/styles/code.css`), `utf8`)
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

  it(`decorates fourth-level headings without changing title text, markup or subsection numbering`, () => {
    const markdown = `### 样本检查\n\n#### 特征区分度\n\n#### 01 **稳定性**与[方法](https://example.com)\n\n### 结果\n\n##### 附注`
    const root = document.createElement(`div`)
    root.innerHTML = render(markdown)
    const headings = root.querySelectorAll(`h4.wechat-minor-heading`)
    expect(headings).toHaveLength(2)
    expect(headings[0].textContent).toBe(`特征区分度`)
    expect(headings[0].getAttribute(`data-heading`)).toBe(`true`)
    expect(headings[0].querySelector(`.wechat-heading-square`)?.getAttribute(`aria-hidden`)).toBe(`true`)
    expect(headings[1].textContent).toBe(`01 稳定性与方法`)
    expect(headings[1].querySelector(`.wechat-heading-label strong`)?.textContent).toBe(`稳定性`)
    expect(headings[1].querySelector(`a`)?.getAttribute(`href`)).toBe(`https://example.com`)
    expect([...root.querySelectorAll(`.wechat-subsection .wechat-heading-number`)].map(el => el.textContent)).toEqual([`01`, `02`])
    expect(root.querySelector(`h5 .wechat-heading-square`)).toBeNull()
    expect(render(markdown, false)).not.toContain(`wechat-heading-square`)
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

  it(`keeps numbered heading layout and underlines when editor cleanup removes classes and empty spans`, async () => {
    await applyTheme({
      themeName: `default`,
      customCSS: referenceCSS,
      variables: { primaryColor: `#c00000`, fontFamily: WECHAT_REFERENCE_FONT, fontSize: `14px`, lineHeight: `1.6` },
    })
    const root = document.createElement(`div`)
    root.innerHTML = juice(`${await getStylesToAdd()}${render(`## 为什么选 hscredit?\n\n### 2026.11 **策略**与[方法](https://example.com)\n\n## 很长的中文标题和 abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ`)}`)
    // Exercise an HTML round trip without relying on the editor's page CSS,
    // class names or empty decoration nodes. This is a portability stress case,
    // not an implementation of WeChat's undocumented sanitizer.
    for (const span of root.querySelectorAll(`span`)) {
      if (!span.childNodes.length)
        span.remove()
    }
    for (const element of root.querySelectorAll(`*`)) {
      for (const attr of [...element.attributes]) {
        if (attr.name === `class` || attr.name === `id` || attr.name.startsWith(`data-`))
          element.removeAttribute(attr.name)
      }
    }
    // The inspected WeChat preview also wraps text in <span leaf="">.
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const textNodes: Node[] = []
    while (walker.nextNode())
      textNodes.push(walker.currentNode)
    for (const text of textNodes) {
      const leaf = document.createElement(`span`)
      leaf.setAttribute(`leaf`, ``)
      text.parentNode!.replaceChild(leaf, text)
      leaf.append(text)
    }
    const cleanedHtml = root.innerHTML
    root.innerHTML = cleanedHtml
    const headings = [...root.querySelectorAll<HTMLElement>(`h2,h3`)]
    expect(headings.map(heading => heading.textContent)).toEqual([
      `零为什么选 hscredit?`,
      `2026.11策略与方法`,
      `一很长的中文标题和 abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ`,
    ])
    for (const heading of headings) {
      const row = heading.firstElementChild as HTMLElement
      const numberCell = row.firstElementChild as HTMLElement
      const badge = numberCell.firstElementChild as HTMLElement
      const label = row.lastElementChild as HTMLElement
      expect(row.style.display).toBe(`table`)
      expect(row.style.width).toBe(heading.tagName === `H2` ? `100%` : `auto`)
      expect(row.style.maxWidth).toBe(`100%`)
      expect(numberCell.style.verticalAlign).toBe(heading.tagName === `H2` ? `middle` : `bottom`)
      expect(numberCell.style.whiteSpace).toBe(`nowrap`)
      expect(badge.style.display).toBe(`inline-block`)
      expect(label.style.display).toBe(`table-cell`)
      expect(label.style.overflowWrap).toBe(`anywhere`)
      if (heading.tagName === `H2`) {
        expect(badge.style.height).toBe(`25px`)
        expect(label.style.borderWidth).toBe(`0px`)
        expect(label.style.boxShadow).toBe(`none`)
        const text = label.firstElementChild as HTMLElement
        const rule = label.lastElementChild as HTMLElement
        expect(text.style.lineHeight).toBe(`25px`)
        expect(text.style.borderWidth).toBe(`0px`)
        expect(text.style.boxShadow).toBe(`none`)
        expect(rule.style.height).toBe(`1px`)
        expect(rule.style.backgroundColor).toBe(`rgb(192, 0, 0)`)
        expect(rule.querySelector(`br`)).not.toBeNull()
      }
      else {
        expect(label.style.borderBottom).toBe(`1px solid rgb(192, 0, 0)`)
      }
    }
    expect(headings[1].querySelector(`strong`)?.textContent).toBe(`策略`)
    expect(headings[1].querySelector(`a`)?.getAttribute(`href`)).toBe(`https://example.com`)
    expect(root.querySelector(`style,link`)).toBeNull()
  })

  it.each([
    [`#c00000`, `rgba(192, 0, 0, 0.28)`],
    [`#28756b`, `rgba(40, 117, 107, 0.28)`],
    [`rgb(36, 91, 131)`, `rgba(36, 91, 131, 0.28)`],
  ])(`inlines typography, title geometry and theme-colored code shadow for %s`, async (primaryColor, shadow) => {
    const variables = { primaryColor, fontFamily: WECHAT_REFERENCE_FONT, fontSize: `14px`, lineHeight: `1.6` }
    const palette = componentPalette(variables)
    await applyTheme({
      themeName: `default`,
      customCSS: `${referenceCSS}\n:root { --md-code-shadow: ${palette.codeShadow}; }\n${articleCodeCSS}`,
      variables,
    })
    const html = render(referenceMarkdown)
    const css = await getStylesToAdd()
    const inlined = juice(`${css}<style>${codeCSS}</style>${html}`, { inlinePseudoElements: true, preserveImportant: true })
    const root = document.createElement(`div`)
    root.innerHTML = wrapArticleHtml(inlined, { fontFamily: WECHAT_REFERENCE_FONT, fontSize: `14px`, lineHeight: `1.6`, referenceTheme: true })
    const badge = root.querySelector<HTMLElement>(`.wechat-chapter .wechat-heading-number`)!
    expect(badge.style.backgroundColor).toBe(`rgb(192, 0, 0)`)
    expect(badge.style.minWidth).toBe(`25px`)
    const minorHeading = root.querySelector<HTMLElement>(`h4.wechat-minor-heading`)!
    const square = minorHeading.querySelector<HTMLElement>(`.wechat-heading-square`)!
    expect(minorHeading.textContent).toBe(`特征区分度`)
    expect(minorHeading.style.fontFamily).toContain(`KaiTi`)
    expect(minorHeading.style.fontSize).toBe(`14px`)
    expect(minorHeading.style.color).toBe(`rgb(38, 38, 38)`)
    expect(minorHeading.style.letterSpacing).toBe(`1.5px`)
    expect(minorHeading.style.fontWeight).toBe(`700`)
    expect(square.style.backgroundColor).toBe(`rgb(192, 0, 0)`)
    expect(square.style.width).toBe(`6px`)
    expect(square.style.height).toBe(`6px`)
    expect(square.style.marginRight).toBe(`12px`)
    const paragraph = [...root.querySelectorAll<HTMLElement>(`p`)].find(p => p.textContent?.startsWith(`数据分析首先`))!
    expect(paragraph.style.fontSize).toBe(WECHAT_REFERENCE_SOURCE.bodyFontSize)
    expect(paragraph.style.textIndent).toBe(`34px`)
    expect(paragraph.style.lineHeight).toBe(`1.6`)
    const pre = root.querySelector<HTMLElement>(`pre`)!
    const code = pre.querySelector<HTMLElement>(`code`)!
    expect(pre.style.backgroundColor).toBe(`rgb(250, 250, 250)`)
    expect(pre.style.boxShadow).toBe(`0 2px 10px ${shadow}`)
    expect(code.style.fontSize).toBe(`12px`)
    expect(code.style.lineHeight).toBe(`26px`)
    expect(root.querySelector(`style, link`)).toBeNull()
    expect(root.innerHTML).not.toMatch(/var\(--|color-mix\(/)
    expect(root.textContent).toContain(`pd.cut`)
  })
})
