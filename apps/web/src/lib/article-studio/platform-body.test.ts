// @vitest-environment jsdom
import type { PostAccount } from '@md/shared/types'
import { ARTICLE_COMPONENTS } from '@article-studio/article-kit'
import starter from '@article-studio/article-kit/starter.md?raw'
import { initRenderer } from '@md/core/renderer'
import { renderMarkdown } from '@md/core/utils'
import { describe, expect, it, vi } from 'vitest'
import { buildPublishTasks } from '@/services/publish/tasks'
// @ts-expect-error COSE ships this adapter as plain JavaScript.
import { fillJuejinContent } from '../../../../../vendor/cose/packages/core/src/platforms/juejin.js'

async function deliver(source: string, html: string, channels: string[]) {
  const accounts: PostAccount[] = channels.map(type => ({ type, uid: type, title: type, displayName: '', home: '', icon: '', checked: true, loggedIn: true }))
  const fields = Object.fromEntries(channels.map(type => [type, { title: '示例', thumb: '', desc: '' }]))
  return (await buildPublishTasks({ markdown: source, html }, accounts, fields)).map(task => task.post)
}

describe('article body formats sent to COSE', () => {
  it('delivers rendered components, a GFM table and highlighted code to three different editors', async () => {
    const renderer = initRenderer({ components: Object.fromEntries(ARTICLE_COMPONENTS.map(c => [c.name, c])), isShowLineNumber: true })
    const source = [starter, '<div>手写 <strong>强调</strong> 和 <a href="https://example.com/doc">文档</a></div>', '`<aside>`', '```html\n<section>\n  <b>示例</b>\n</section>\n```'].join('\n\n')
    const { html } = renderMarkdown(source, renderer)
    const [wechat, juejin, douban] = await deliver(source, html, ['wechat', 'juejin', 'douban'])
    expect(wechat.content).toBe(html)
    expect(wechat.wechatHtml).toContain('hljs-')
    expect(juejin.markdown).toContain('演示样本量')
    expect(juejin.markdown).toContain('8 条')
    expect(juejin.markdown).toContain('先给结论，再给证据')
    expect(juejin.markdown).toMatch(/\|\s*年龄区间\s*\|/)
    expect(juejin.markdown).toContain('**强调**')
    expect(juejin.markdown).toContain('[文档](https://example.com/doc)')
    expect(juejin.markdown).toContain('`<aside>`')
    expect(juejin.markdown).toContain('```html\n<section>\n  <b>示例</b>\n</section>\n```')
    expect(juejin.markdown).toMatch(/```sql\nSELECT\n {4}age_group/)
    expect(juejin.markdown).not.toMatch(/<\/?(?:MetricCardV1|ArticleLeadV1|KeyFindingV1|div|span|strong)\b|hljs-|• /i)
    expect(douban.content).toContain('先给结论，再给证据')
    expect(douban.content).toMatch(/演示样本量\n+8 条/)
    expect(douban.content).toContain('<b>示例</b>')
    expect(douban.content).toContain('文档（https://example.com/doc）')
    expect(douban.content).not.toMatch(/MetricCardV1|\*\*强调\*\*|```|<div>/)
    expect(douban.markdown).toBe(douban.content)
  })

  it('keeps diagram fences and math expressions in articles that also contain HTML', async () => {
    const source = '<p>分析</p>\n\n```mermaid\ngraph LR\n  A --> B\n```\n\n$x_i=a*b$'
    const html = '<p>分析</p><div class="mermaid-diagram"><svg></svg></div><p><span data-math-raw="$x_i=a*b$"><svg></svg></span></p>'
    const [post] = await deliver(source, html, ['juejin'])
    expect(post.markdown).toContain('```mermaid\ngraph LR\n  A --> B\n```')
    expect(post.markdown).toContain('$x_i=a*b$')
  })

  it('retains original native Markdown even when code examples contain component syntax', async () => {
    const source = '# 原稿\n\n[文档][ref] 与 `<span>`\n\n~~~vue\n<MetricCardV1 />\n~~~\n\n[ref]: https://example.com'
    const [post] = await deliver(source, '<h1>原稿</h1>', ['csdn'])
    expect(post.markdown).toBe(source)
  })

  it.each([
    ['<span>可见正文</span>', '可见正文'],
    ['<!-- 编辑备注 -->', ''],
  ])('fills the local Markdown editor with the prepared body for %s', async (source, expected) => {
    const [post] = await deliver(source, `<section>${source}</section>`, ['juejin'])
    document.body.innerHTML = '<div class="bytemd-body"><textarea></textarea></div>'
    vi.useFakeTimers()
    vi.stubGlobal('waitFor', async () => null)
    try {
      const result = fillJuejinContent(post.title, post.markdown, post.content)
      await vi.runAllTimersAsync()
      expect(await result).toMatchObject({ success: true })
      expect(document.querySelector('textarea')?.value).toBe(expected)
    }
    finally {
      vi.unstubAllGlobals()
      vi.useRealTimers()
      document.body.replaceChildren()
    }
  })

  it('uses the same image upload key in Markdown and rich text, and only the description in plain text', async () => {
    const src = 'data:image/png;base64,Ynl0ZXM='
    const source = `<WeChatFigureBannerV1 src="${src}" alt="报表" text="月度结果" />`
    const html = `<section><img src="${src}" alt="报表"><p>月度结果</p></section>`
    const [md, plain] = await deliver(source, html, ['juejin', 'douban'])
    const key = md.images![0].key
    expect(md.markdown).toContain(`![报表](${key})`)
    expect(md.content).toContain(`src="${key}"`)
    expect(md.markdown).toContain('月度结果')
    expect(plain.images).toBeUndefined()
    expect(plain.content).toMatch(/报表\s+月度结果/)
    const [onlyPlain] = await deliver(source, html.replace(src, 'https://unreachable.invalid/1.png'), ['douban'])
    expect(onlyPlain.content).toBe(plain.content)
  })
})
