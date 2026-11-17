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
    expect(wechat.content).toContain('演示样本量')
    expect(wechat.content).toContain('先给结论，再给证据')
    expect(wechat.content).toContain('<strong>强调</strong> 和 文档')
    expect(wechat.content).not.toContain('href="https://example.com/doc"')
    expect(wechat.content).toBe(wechat.wechatHtml)
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

  it('unwraps external links only in the WeChat draft, including links around an uploaded image', async () => {
    const allowed = ['https://mp.weixin.qq.com/s/a?x=1#p', '//MP.WEIXIN.QQ.COM/s/b', 'http://mp.weixin.qq.com/s/c']
    const rejected = ['https://example.org', 'https://mp.weixin.qq.com.example.org/s', 'https://mp.weixin.qq.com@example.org/s', 'https://sub.mp.weixin.qq.com', '/relative', '#local', 'mailto:a@example.org', 'javascript:void(0)', 'https://[bad']
    const bytes = 'data:image/png;base64,Ynl0ZXM='
    const html = [
      ...allowed.map(href => `<a href="${href}">公众号</a>`),
      ...rejected.map((href, i) => `<a href="${href}"><em>资料 ${i}</em></a>`),
      `<a href="https://example.org/report"><img src="${bytes}" alt="报告"></a>`,
      '<code>https://example.org</code>',
    ].join('')
    const [wechat, other] = await deliver('正文', html, ['wechat', 'zhihu'])
    const root = document.createElement('div')
    root.innerHTML = wechat.content
    expect(wechat.content).toBe(wechat.wechatHtml)
    expect([...root.querySelectorAll('a')].map(a => a.getAttribute('href'))).toEqual(allowed)
    expect([...root.querySelectorAll('em')].map(em => em.textContent)).toEqual(rejected.map((_, i) => `资料 ${i}`))
    expect(root.querySelector('img')?.getAttribute('src')).toBe(wechat.images![0].key)
    expect(root.querySelector('a img')).toBeNull()
    expect(root.querySelector('code')?.textContent).toBe('https://example.org')
    expect(other.content).toBe(html.replace(bytes, wechat.images![0].key))
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
