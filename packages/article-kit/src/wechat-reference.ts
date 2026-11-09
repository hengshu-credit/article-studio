import type { CustomComponentDef } from '@md/shared/types'

export const WECHAT_REFERENCE_PRESET = `wechat-kaiti-red-v1`
export const WECHAT_REFERENCE_FONT = `KaiTi, STKaiti, '楷体', '楷体_GB2312', SimKai, serif`

/** Values inspected from the article DOM, rather than estimated from a screenshot. */
export const WECHAT_REFERENCE_SOURCE = {
  url: `https://mp.weixin.qq.com/s/z-XzPniWyzlyhh8gJAqwjA`,
  inspectedOn: `2026-11-03`,
  primary: `#c00000`,
  text: `#262626`,
  bodyFontSize: `14px`,
  bodyLineHeight: `1.6`,
  bodyIndent: `34px`,
  introBackground: `#fcf2f2`,
  introLineHeight: `1.75`,
  codeTheme: `atom-one-light`,
  codeBackground: `#fafafa`,
  codeFontSize: `12px`,
  codeLineHeight: `26px`,
  codeShadow: `0 2px 10px rgba(0, 0, 0, 0.55)`,
  nativeTables: 0,
} as const

const font = `font-family:${WECHAT_REFERENCE_FONT};font-size:14px;`
const primary = WECHAT_REFERENCE_SOURCE.primary
const reportImage = `<section data-wechat-figure-frame style="margin:0 3px;line-height:0;"><img src="{{src}}" alt="{{alt}}" style="display:block;width:100%;max-width:100%;height:auto;margin:0;box-sizing:border-box;border:1px solid #dedede;border-radius:0;box-shadow:0 0 5px rgba(0,0,0,0.18);" /></section>`

export const WECHAT_REFERENCE_COMPONENTS: CustomComponentDef[] = [
  {
    id: `wechat-reference-intro-v1`,
    name: `WeChatIntroV1`,
    builtIn: true,
    markdownChildren: true,
    description: `主题色顶线与柔和底色的引言块`,
    props: [{ name: `title`, description: `引言标题`, default: `引言` }],
    template: `<section data-wechat-reference="intro" style="margin:20px 0 32px;${font}color:#000000;"><section style="height:14px;line-height:14px;background:${primary};text-align:left;"><span style="display:inline-block;padding:0 6px 0 0;background:#ffffff;color:${primary};font-weight:700;letter-spacing:2px;${font}"># {{title}} #</span></section><section data-wechat-intro-body style="background:#fcf2f2;padding:10px;line-height:1.75;letter-spacing:1.5px;text-align:justify;">{{children}}</section></section>`,
    example: `<WeChatIntroV1 title="引言">\n\n先交代问题、分析范围和本文的阅读目标。此处可以继续写 **Markdown**。\n\n</WeChatIntroV1>`,
  },
  {
    id: `wechat-reference-banner-v1`,
    name: `WeChatBannerV1`,
    builtIn: true,
    description: `主题色背景的栏目短句`,
    props: [{ name: `text`, description: `栏目短句`, required: true }],
    template: `<section data-wechat-reference="banner" style="margin:8px 0 24px;padding:3px 8px;${font}font-size:12px;line-height:1.6;letter-spacing:2px;text-align:center;color:#ffffff;background:${primary};">{{text}}</section>`,
    example: `<WeChatBannerV1 text="用数据检验观点，用代码记录方法" />`,
  },
  {
    id: `wechat-reference-highlight-v1`,
    name: `WeChatHighlightV1`,
    builtIn: true,
    markdownChildren: true,
    description: `用主题色突出方法要点与强调段落`,
    props: [],
    template: `<section data-wechat-reference="highlight" style="margin:14px 0;${font}color:${primary};line-height:1.6;text-align:justify;">{{children}}</section>`,
    example: `<WeChatHighlightV1>\n\n强调样本口径、方法条件和分析边界。\n\n</WeChatHighlightV1>`,
  },
  {
    id: `wechat-reference-figure-v1`,
    name: `WeChatFigureV1`,
    builtIn: true,
    description: `报表图片：保留原文以图片呈现复杂图表的方式`,
    props: [
      { name: `src`, description: `可公开访问的图片 HTTPS 地址`, required: true },
      { name: `caption`, description: `图表说明`, default: `图表说明` },
    ],
    template: `<section data-wechat-reference="figure" style="margin:20px 0;text-align:center;${font}">${reportImage.replace(`{{alt}}`, `{{caption}}`)}{{#if caption}}<p style="margin:8px 0 0;font-size:12px;line-height:1.6;color:#777777;text-indent:0;text-align:center;">{{caption}}</p>{{/if}}</section>`,
    example: `<WeChatFigureV1 src="https://example.com/report.png" caption="请替换为自己的报表图片地址" />`,
  },
  {
    id: `wechat-reference-figure-banner-v1`,
    name: `WeChatFigureBannerV1`,
    builtIn: true,
    description: `报表图片与底部主题色标语，紧凑组合用于文章开篇`,
    props: [
      { name: `src`, description: `报表图片地址`, required: true },
      { name: `text`, description: `图片下方的标语或标题`, required: true },
      { name: `alt`, description: `图片的替代说明`, default: `报表图片` },
    ],
    template: `<section data-wechat-reference="figure-banner" style="margin:20px 0;${font}">${reportImage}<section data-wechat-figure-banner style="margin:4px 0 0;padding:2px 8px;font-size:12px;line-height:1.6;letter-spacing:1px;text-align:center;color:#ffffff;background:${primary};">{{text}}</section></section>`,
    example: `<WeChatFigureBannerV1 src="https://example.com/report.png" text="用数据检验观点，用代码记录方法" alt="策略上线报告" />`,
  },
]

function chineseNumber(value: number): string {
  const digits = `零一二三四五六七八九`
  if (value < 10)
    return digits[value]
  if (value < 100)
    return `${value >= 20 ? digits[Math.floor(value / 10)] : ``}十${value % 10 ? digits[value % 10] : ``}`
  return String(value)
}

function headingParts(heading: HTMLElement, fallback: string): { number: string, labelHtml: string } {
  const clone = heading.cloneNode(true) as HTMLElement
  // Only remove a prefix in the first text node, preserving links/emphasis in the title.
  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT)
  const first = walker.nextNode()
  const match = first?.textContent?.match(/^\s*([零〇一二三四五六七八九十百]+|\d+(?:\.\d+)*)[、.．\s]+/)
  if (match && first) {
    first.textContent = first.textContent!.replace(/^\s*([零〇一二三四五六七八九十百]+|\d+(?:\.\d+)*)[、.．\s]+/, ``)
    return { number: match[1], labelHtml: clone.innerHTML }
  }
  return { number: fallback, labelHtml: clone.innerHTML }
}

function decorateHeading(heading: HTMLElement, number: string, chapter: boolean): void {
  const parts = headingParts(heading, number)
  const row = document.createElement(`span`)
  row.className = chapter ? `wechat-chapter-row` : `wechat-subsection-row`
  const badge = document.createElement(`span`)
  badge.className = `wechat-heading-number`
  badge.textContent = parts.number
  // Keep the badge's own height independent of a multi-line title's cell.
  const numberCell = document.createElement(`span`)
  numberCell.className = `wechat-heading-number-cell`
  numberCell.append(badge)
  const label = document.createElement(`span`)
  label.className = `wechat-heading-label`
  label.innerHTML = parts.labelHtml
  if (chapter) {
    const text = document.createElement(`span`)
    text.className = `wechat-heading-text`
    text.append(...label.childNodes)
    const rule = document.createElement(`span`)
    rule.className = `wechat-heading-rule`
    rule.setAttribute(`aria-hidden`, `true`)
    // The reference article retains <br> inside its decoration sections.
    // An entirely empty span was removed by WeChat; keep this line non-empty.
    rule.append(document.createElement(`br`))
    label.append(text, rule)
  }
  row.append(numberCell, label)
  heading.replaceChildren(row)
  heading.classList.add(chapter ? `wechat-chapter` : `wechat-subsection`)
}

function decorateMinorHeading(heading: HTMLElement): void {
  const marker = document.createElement(`span`)
  marker.className = `wechat-heading-square`
  marker.setAttribute(`aria-hidden`, `true`)
  const label = document.createElement(`span`)
  label.className = `wechat-heading-label`
  label.append(...heading.childNodes)
  heading.replaceChildren(marker, label)
  heading.classList.add(`wechat-minor-heading`)
}

/** Add real nodes instead of CSS counters/pseudo-elements, which WeChat may discard. */
export function decorateWeChatReference(html: string, referenceTheme: boolean): string {
  if (!referenceTheme && !html.includes(`data-wechat-reference=`))
    return html
  const root = document.createElement(`div`)
  root.innerHTML = html
  if (referenceTheme) {
    let chapterIndex = 0
    let subsectionIndex = 0
    for (const heading of root.querySelectorAll<HTMLElement>(`h2, h3`)) {
      if (heading.tagName === `H2`) {
        decorateHeading(heading, chineseNumber(chapterIndex++), true)
        subsectionIndex = 0
      }
      else {
        decorateHeading(heading, String(++subsectionIndex).padStart(2, `0`), false)
      }
    }
    for (const heading of root.querySelectorAll<HTMLElement>(`h4`))
      decorateMinorHeading(heading)
    // Draw the Mac controls with local inline shapes, without the source's remote SVG background.
    for (const sign of root.querySelectorAll<HTMLElement>(`.mac-sign`)) {
      sign.replaceChildren()
      sign.style.padding = `10px 10px 0`
      for (const color of [`#fc625d`, `#fdbc40`, `#35cd4b`]) {
        const dot = document.createElement(`span`)
        Object.assign(dot.style, { display: `inline-block`, width: `10px`, height: `10px`, marginRight: `4px`, borderRadius: `50%`, backgroundColor: color })
        sign.append(dot)
      }
    }
  }
  for (const body of root.querySelectorAll<HTMLElement>(`[data-wechat-intro-body], [data-wechat-reference="highlight"]`)) {
    for (const p of body.querySelectorAll<HTMLElement>(`p`)) {
      Object.assign(p.style, { margin: `0`, fontFamily: WECHAT_REFERENCE_FONT, fontSize: `14px`, lineHeight: body.hasAttribute(`data-wechat-intro-body`) ? `1.75` : `1.6`, letterSpacing: `1.5px`, textIndent: `28px`, textAlign: `justify`, color: body.hasAttribute(`data-wechat-intro-body`) ? `#000000` : primary })
    }
  }
  return root.innerHTML
}
