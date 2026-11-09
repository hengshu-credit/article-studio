// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { applyComponentTheme, ARTICLE_COMPONENTS, DEFAULT_COMPONENT_THEME, NO_INDENT_MARKER } from '@article-studio/article-kit'
import { initRenderer } from '@md/core/renderer'
import { postProcessHtml, renderMarkdown } from '@md/core/utils'
import juice from 'juice'
import { describe, expect, it } from 'vitest'

const themeCSS = readFileSync(resolve(process.cwd(), `../../packages/article-kit/styles/wechat-kaiti-red-v1.css`), `utf8`)

describe(`paragraph formatting in rendered and delivered articles`, () => {
  it(`keeps unmarked paragraphs indented and marked paragraphs flush left after CSS inlining`, () => {
    const source = `默认段落\n\n${NO_INDENT_MARKER}**不缩进** 和 [链接](https://example.com)\n\n\`\`\`html\n${NO_INDENT_MARKER}\n\`\`\`\n\n<MetricCardV1 label="样本" value="8 条" />`
    const renderer = initRenderer({ components: Object.fromEntries(ARTICLE_COMPONENTS.map(component => [component.name, component])) })
    const { html, readingTime } = renderMarkdown(source, renderer)
    const themed = applyComponentTheme(postProcessHtml(html, readingTime, renderer), DEFAULT_COMPONENT_THEME)
    const result = juice(`<style>${themeCSS}</style>${themed}`, { preserveImportant: true })
    const root = document.createElement(`div`)
    root.innerHTML = result
    const paragraphs = [...root.querySelectorAll(`p`)]
    expect(paragraphs.find(p => p.textContent === `默认段落`)?.style.textIndent).toBe(`34px`)
    const flushLeft = paragraphs.find(p => p.textContent?.includes(`不缩进`))!
    expect(flushLeft.style.textIndent).toBe(`0px`)
    expect(flushLeft.querySelector(`strong`)?.textContent).toBe(`不缩进`)
    expect(flushLeft.querySelector(`a`)?.href).toBe(`https://example.com/`)
    expect(root.querySelector(`[data-article-indent]`)).toBeNull()
    expect(root.querySelector(`pre`)?.textContent?.replace(/\u00A0/g, ` `)).toContain(NO_INDENT_MARKER)
    expect(root.querySelector(`[data-md-component="MetricCardV1"]`)?.textContent).toContain(`8 条`)
  })
  it(`preserves text inside a manually edited marker`, () => {
    const html = applyComponentTheme(`<p><span data-article-indent="none"><strong>保留文字</strong></span>和后文</p>`, DEFAULT_COMPONENT_THEME)
    const root = document.createElement(`div`)
    root.innerHTML = html
    expect(root.querySelector(`p`)?.style.textIndent).toBe(`0px`)
    expect(root.querySelector(`strong`)?.textContent).toBe(`保留文字`)
    expect(root.textContent).toBe(`保留文字和后文`)
  })
})
