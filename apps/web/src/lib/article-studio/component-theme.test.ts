// @vitest-environment jsdom
import { applyComponentTheme, ARTICLE_COMPONENTS, ARTICLE_PRESETS, DEFAULT_COMPONENT_THEME, mergeArticleComponents } from '@article-studio/article-kit'
import { BUILT_IN_COMPONENTS } from '@md/core/extensions'
import { initRenderer } from '@md/core/renderer'
import { postProcessHtml, renderMarkdown } from '@md/core/utils'
import juice from 'juice'
import { describe, expect, it } from 'vitest'
import { buildComponentSnippet } from '@/lib/component-snippet'
import { componentPreviewDocument } from './component-preview'

const components = mergeArticleComponents(BUILT_IN_COMPONENTS, []).filter(item => !item.inline && !item.hidden)

function render(markdown: string) {
  const renderer = initRenderer({ components: Object.fromEntries(components.map(component => [component.name, component])) })
  const { html, readingTime } = renderMarkdown(markdown, renderer)
  return postProcessHtml(html, readingTime, renderer)
}

describe(`shared component theme`, () => {
  it.each(ARTICLE_PRESETS)(`applies $name typography and square geometry to every component`, (preset) => {
    const theme = { ...DEFAULT_COMPONENT_THEME, primaryColor: preset.color, fontFamily: `KaiTi, serif`, fontSize: `18px`, lineHeight: `1.9` }
    for (const component of components) {
      const source = render(component.example || buildComponentSnippet(component))
      const dom = document.createElement(`div`)
      dom.innerHTML = applyComponentTheme(source, theme)
      const root = dom.querySelector<HTMLElement>(`[data-md-component="${component.name}"]`)!
      expect(root, component.name).not.toBeNull()
      expect(root.style.borderRadius, component.name).toBe(`0px`)
      expect(root.style.boxShadow, component.name).toBe(`none`)
      expect(root.style.fontFamily, component.name).toBe(`KaiTi, serif`)
      expect(root.textContent, component.name).not.toContain(`Unknown component`)
      expect(root.outerHTML, component.name).not.toMatch(/var\(--md-comp/)
      const thumbnail = new DOMParser().parseFromString(componentPreviewDocument(component, theme), `text/html`)
      const mini = thumbnail.querySelector<HTMLElement>(`[data-md-component="${component.name}"]`)!
      expect(mini.style.color, component.name).toBe(root.style.color)
      expect(mini.style.backgroundColor, component.name).toBe(root.style.backgroundColor)
      expect(mini.style.fontSize, component.name).toBe(root.style.fontSize)
      expect(mini.style.fontFamily, component.name).toBe(root.style.fontFamily)
    }
  })

  it(`changes old fixed-blue and fixed-red components together without changing their content`, () => {
    const source = render(`<MetricCardV1 label="样本量" value="8 条" detail="演示数据" />\n\n<WeChatIntroV1 title="引言">\n\n**保留结论**。\n\n</WeChatIntroV1>`)
    const theme = { ...DEFAULT_COMPONENT_THEME, primaryColor: `#28756b` }
    const dom = document.createElement(`div`)
    dom.innerHTML = applyComponentTheme(source, theme)
    expect(dom.textContent).toContain(`8 条`)
    expect(dom.querySelector(`strong`)?.textContent).toBe(`保留结论`)
    expect(dom.querySelector<HTMLElement>(`[data-md-component="MetricCardV1"] p:nth-child(2)`)?.style.color).toBe(`rgb(40, 117, 107)`)
    expect(dom.querySelector<HTMLElement>(`[data-md-component="WeChatIntroV1"] > section`)?.style.backgroundColor).toBe(`rgb(40, 117, 107)`)
    expect(dom.innerHTML).not.toMatch(/#245b83|#c00000/)
  })

  it(`preserves styled component content after CSS is inlined for delivery`, () => {
    const theme = { ...DEFAULT_COMPONENT_THEME, primaryColor: `#c00000`, fontSize: `14px` }
    const source = render(ARTICLE_COMPONENTS.find(component => component.name === `MetricCardV1`)!.example!)
    const themed = applyComponentTheme(source, theme)
    const dom = document.createElement(`div`)
    dom.innerHTML = juice(themed)
    expect(dom.querySelector<HTMLElement>(`[data-md-component]`)?.style.borderRadius).toBe(`0px`)
    expect(dom.querySelector<HTMLElement>(`[data-md-component] p:nth-child(2)`)?.style.color).toBe(`rgb(192, 0, 0)`)
    expect(dom.textContent).toContain(`10,000 条`)
  })

  it.each([`#c00000`, `#28756b`])(`keeps a compact figure/banner with shared thumbnail and delivery styling in %s`, (primaryColor) => {
    const theme = { ...DEFAULT_COMPONENT_THEME, primaryColor, fontSize: `14px` }
    const component = ARTICLE_COMPONENTS.find(item => item.name === `WeChatFigureBannerV1`)!
    const markdown = `<WeChatFigureBannerV1 src="https://example.com/report.png" text="用数据检验观点，用代码记录方法" alt="策略上线报告" />`
    const dom = document.createElement(`div`)
    dom.innerHTML = juice(`<style>img{margin:7px auto}p{margin:14px}</style>${applyComponentTheme(render(markdown), theme)}`)
    const root = dom.querySelector<HTMLElement>(`[data-md-component="WeChatFigureBannerV1"]`)!
    const frame = root.querySelector<HTMLElement>(`[data-wechat-figure-frame]`)!
    const img = root.querySelector(`img`)!
    const banner = root.querySelector<HTMLElement>(`[data-wechat-figure-banner]`)!
    expect(img.getAttribute(`src`)).toBe(`https://example.com/report.png`)
    expect(img.alt).toBe(`策略上线报告`)
    expect(img.style.margin).toBe(`0px`)
    expect(img.style.width).toBe(`100%`)
    expect(img.style.height).toBe(`auto`)
    expect(img.style.maxHeight).toBe(`none`)
    expect(img.style.borderColor).toBe(`rgb(222, 222, 222)`)
    expect(img.style.boxShadow).toBe(`0 0 5px rgba(0, 0, 0, 0.18)`)
    expect(frame.style.marginBottom).toBe(`0px`)
    expect(banner.style.marginTop).toBe(`4px`)
    expect(banner.style.padding).toBe(`2px 8px`)
    expect(banner.style.fontSize).toBe(`12px`)
    expect(banner.style.lineHeight).toBe(`1.6`)
    expect(banner.style.color).toBe(`rgb(255, 255, 255)`)
    expect(banner.textContent).toBe(`用数据检验观点，用代码记录方法`)
    expect(root.querySelector(`p,style,link`)).toBeNull()
    const thumbnail = new DOMParser().parseFromString(componentPreviewDocument(component, theme), `text/html`)
    expect(thumbnail.querySelector<HTMLElement>(`[data-wechat-figure-banner]`)?.getAttribute(`style`)).toBe(banner.getAttribute(`style`))
    expect(thumbnail.querySelector(`img`)?.getAttribute(`style`)).toBe(img.getAttribute(`style`))
  })

  it(`compacts existing adjacent figure/banner tags and omits an explicitly empty caption`, () => {
    const figure = `<WeChatFigureV1 src="https://example.com/report.png" caption="" />`
    const banner = `<WeChatBannerV1 text="用数据检验观点，用代码记录方法" />`
    const dom = document.createElement(`div`)
    dom.innerHTML = applyComponentTheme(render(`${figure}\n${banner}`), DEFAULT_COMPONENT_THEME)
    const picture = dom.querySelector<HTMLElement>(`[data-md-component="WeChatFigureV1"]`)!
    const strip = dom.querySelector<HTMLElement>(`[data-md-component="WeChatBannerV1"]`)!
    expect(picture.querySelector(`p`)).toBeNull()
    expect(picture.style.marginBottom).toBe(`4px`)
    expect(strip.style.marginTop).toBe(`0px`)
    expect(picture.querySelector(`img`)?.style.marginBottom).toBe(`0px`)

    dom.innerHTML = applyComponentTheme(render(`${figure}\n\n中间有正文。\n\n${banner}`), DEFAULT_COMPONENT_THEME)
    expect(dom.querySelector<HTMLElement>(`[data-md-component="WeChatFigureV1"]`)?.style.marginBottom).toBe(`20px`)
    expect(dom.querySelector<HTMLElement>(`[data-md-component="WeChatBannerV1"]`)?.style.marginTop).toBe(`20px`)
  })

  it(`retains non-empty legacy captions and escapes combined-component labels`, () => {
    const dom = document.createElement(`div`)
    dom.innerHTML = applyComponentTheme(render(`<WeChatFigureV1 src="https://example.com/report.png" caption="图一：策略报告" />\n\n<WeChatFigureBannerV1 src="https://example.com/report.png" text="&lt;script&gt;bad()&lt;/script&gt;" />`), DEFAULT_COMPONENT_THEME)
    expect(dom.querySelector(`p`)?.textContent).toBe(`图一：策略报告`)
    expect(dom.querySelector(`script`)).toBeNull()
    expect(dom.querySelector(`[data-wechat-figure-banner]`)?.textContent).toBe(`<script>bad()</script>`)
  })
})
