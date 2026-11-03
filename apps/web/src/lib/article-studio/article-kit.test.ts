import { ARTICLE_COMPONENTS, mergeArticleComponents } from '@article-studio/article-kit'
// @vitest-environment jsdom
import starterMarkdown from '@article-studio/article-kit/starter.md?raw'
import { initRenderer } from '@md/core/renderer'
import { postProcessHtml, renderMarkdown } from '@md/core/utils'
import juice from 'juice'
import { describe, expect, it } from 'vitest'
import { inspectArticleHtml, makeArticleDocument, wrapArticleHtml } from './artifact-html'

function render(content: string): string {
  const renderer = initRenderer({ components: Object.fromEntries(ARTICLE_COMPONENTS.map(component => [component.name, component])) })
  const { html, readingTime } = renderMarkdown(content, renderer)
  return postProcessHtml(html, readingTime, renderer)
}

describe(`versioned article components`, () => {
  it(`renders Markdown inside finding and method components, retaining lists and emphasis`, () => {
    const html = render(`<KeyFindingV1 title="结论">\n\n**训练集**拟合边界。\n\n- 验证集复用\n- 缺失值单独处理\n\n</KeyFindingV1>`)
    const root = document.createElement(`div`)
    root.innerHTML = html
    expect(root.querySelector(`strong`)?.textContent).toBe(`训练集`)
    expect(root.querySelectorAll(`li`)).toHaveLength(2)
    expect(root.textContent).toContain(`结论`)
  })

  it(`does not allow persisted custom definitions to replace versioned components`, () => {
    const original = ARTICLE_COMPONENTS.find(component => component.name === `MetricCardV1`)!
    const merged = mergeArticleComponents([], [{ ...original, template: `<p>changed</p>` }])
    expect(merged.find(component => component.name === original.name)).toBe(original)
  })

  it(`escapes prop markup and strips executable content through the md renderer`, () => {
    const html = render(`<MetricCardV1 label='&lt;img src=x onerror=alert(1)&gt;' value="8 条" detail="演示" />\n\n<script>alert(1)</script>`)
    const root = document.createElement(`div`)
    root.innerHTML = html
    expect(root.querySelector(`img, script`)).toBeNull()
    expect(root.textContent).toContain(`8 条`)
  })

  it(`renders the complete starter article with its data table and Python/SQL code intact`, () => {
    const root = document.createElement(`div`)
    root.innerHTML = render(starterMarkdown)
    expect(root.querySelectorAll(`table tr`)).toHaveLength(4)
    expect(root.querySelectorAll(`pre`)).toHaveLength(2)
    expect(root.textContent).toContain(`pd.cut`)
    expect(root.textContent?.replace(/\u00A0/g, ` `)).toContain(`GROUP BY`)
    expect(root.textContent).not.toContain(`Unknown component`)
    expect(root.querySelectorAll(`KeyFindingV1, MetricCardV1`)).toHaveLength(0)
  })
})

describe(`delivery HTML`, () => {
  it(`keeps inline table, code highlighting and card styles without an external stylesheet`, () => {
    const source = `<h2>分析</h2><table><tr><td>8</td></tr></table><pre><code><span class="hljs-keyword">SELECT</span> 8;</code></pre>${render(`<MetricCardV1 label="样本" value="8 条" detail="演示" />`)}`
    const inlined = juice(`<style>h2{color:#245b83}td{border:1px solid #dce4ed}.hljs-keyword{color:#c678dd}pre{white-space:pre}</style>${source}`)
    const html = wrapArticleHtml(inlined, { fontFamily: `Arial, sans-serif`, fontSize: `16px`, lineHeight: `1.75` })
    const root = document.createElement(`div`)
    root.innerHTML = html
    expect((root.querySelector(`h2`) as HTMLElement).style.color).toBe(`rgb(36, 91, 131)`)
    expect((root.querySelector(`.hljs-keyword`) as HTMLElement).style.color).toBe(`rgb(198, 120, 221)`)
    expect((root.querySelector(`td`) as HTMLElement).style.borderWidth).toBe(`1px`)
    expect(root.querySelector(`style, link`)).toBeNull()
    expect(root.querySelector(`[data-article-kit]`)?.textContent).toContain(`8 条`)
    const doc = new DOMParser().parseFromString(makeArticleDocument(`A < B`, html), `text/html`)
    expect(doc.title).toBe(`A < B`)
    expect(doc.querySelector(`[data-article-kit]`)?.outerHTML).toBe(html)
  })

  it(`detects image, SVG, wide-table and CSS portability issues before delivery`, () => {
    const html = `<img src="blob:local"><svg></svg><table><tr>${`<th>x</th>`.repeat(5)}</tr></table><p style="color:var(--unknown)">x</p>`
    expect(inspectArticleHtml(html)).toHaveLength(4)
    expect(inspectArticleHtml(`<p style="color:#245b83">普通正文</p>`)).toEqual([])
  })
})
