// @vitest-environment jsdom
import { ARTICLE_COMPONENTS } from '@article-studio/article-kit'
import { initRenderer } from '@md/core/renderer'
import { postProcessHtml, renderMarkdown } from '@md/core/utils'
import juice from 'juice'
import { afterEach, describe, expect, it } from 'vitest'
import { componentPreviewDocument } from './component-preview'

afterEach(() => { document.body.replaceChildren() })

function codeArticle(enabled: boolean) {
  const renderer = initRenderer({ isMacCodeBlock: enabled })
  const { html, readingTime } = renderMarkdown(`\`\`\`python\nprint("hello")\n\`\`\``, renderer)
  return postProcessHtml(html, readingTime, renderer)
}

describe(`code titlebar visibility`, () => {
  it(`keeps the off switch effective even under a more specific theme display rule`, () => {
    document.body.innerHTML = `<style>#output .mac-sign{display:block;height:30px}</style><section id="output">${codeArticle(false)}</section>`
    const header = document.querySelector<HTMLElement>(`.mac-sign`)!
    expect(getComputedStyle(header).display).toBe(`none`)
    const exported = document.createElement(`div`)
    exported.innerHTML = juice(document.body.innerHTML)
    expect(exported.querySelector<HTMLElement>(`.mac-sign`)?.style.display).toBe(`none`)
  })
  it(`does not let another hidden preview turn off the active article's titlebar`, () => {
    document.body.innerHTML = `<section id="output">${codeArticle(true)}</section><aside>${codeArticle(false)}</aside>`
    expect(getComputedStyle(document.querySelector(`#output .mac-sign`)!).display).toBe(`flex`)
    expect(getComputedStyle(document.querySelector(`aside .mac-sign`)!).display).toBe(`none`)
  })
})

describe(`component thumbnails`, () => {
  it(`renders a real metric example, with its value and template styles`, () => {
    const component = ARTICLE_COMPONENTS.find(item => item.name === `MetricCardV1`)!
    const doc = new DOMParser().parseFromString(componentPreviewDocument(component), `text/html`)
    expect(doc.body.textContent).toContain(`10,000 条`)
    expect(doc.querySelector(`[style*="30px"]`)).not.toBeNull()
    expect(doc.querySelector(`meta[http-equiv="Content-Security-Policy"]`)?.getAttribute(`content`)).toContain(`default-src 'none'`)
  })
  it(`uses an offline image placeholder and sanitizes executable markup in custom templates`, () => {
    const doc = new DOMParser().parseFromString(componentPreviewDocument({
      id: `test-preview`,
      name: `TestPreview`,
      props: [],
      template: `<section><script>alert(1)</script><img src="https://example.com/track.png" onerror="alert(2)" srcset="https://example.com/large.png 2x" /><p>示例内容</p></section>`,
    }), `text/html`)
    expect(doc.querySelector(`script,[onerror]`)).toBeNull()
    expect(doc.querySelector(`img`)?.getAttribute(`src`)).toMatch(/^data:image\/svg\+xml,/)
    expect(doc.querySelector(`img`)?.hasAttribute(`srcset`)).toBe(false)
    expect(doc.body.textContent).toContain(`示例内容`)
  })
})
