// @vitest-environment jsdom
import type { PostAccount } from '@md/shared/types'
import type { PublishDraftMap } from '@/services/publish/drafts'
import type { CoseAddTaskData, CoseApi, CoseTaskStatus } from '@/types/cose'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { createPublishDraftSession, PUBLISH_DRAFTS_KEY } from '@/services/publish/drafts'
import { buildPublishTasks, runPublishTasks } from '@/services/publish/tasks'
import { StorageManager } from '@/storage/manager'

const defaults = { title: '自动标题', desc: '自动摘要', thumb: 'https://example.com/default.png' }
const material = `/media/${'a'.repeat(64)}.png`
const account = (type: string): PostAccount => ({ type, uid: type, title: type, displayName: '作者', home: '', icon: '', checked: true, loggedIn: true })
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); localStorage.clear() })

describe('article and channel publish drafts', () => {
  it('restores separate channel values, intentional empty fields and selections without mixing articles', () => {
    const saved = ref<PublishDraftMap>({})
    const draft = createPublishDraftSession(saved)
    draft.open('article-a', defaults)
    draft.update({ title: '共用标题' })
    draft.select(['wechat'])
    draft.update({ title: '微信标题', thumb: material, desc: '' })
    draft.select(['wechat', 'juejin'])
    draft.activate('juejin')
    expect(draft.fields.value.title).toBe('共用标题')
    draft.update({ title: '掘金标题', desc: '技术介绍' })
    draft.select(['wechat'])
    expect(draft.fields.value).toEqual({ title: '微信标题', thumb: material, desc: '' })
    draft.select(['wechat', 'juejin'])
    draft.activate('juejin')
    expect(draft.fields.value.title).toBe('掘金标题')

    const reopened = createPublishDraftSession(saved)
    reopened.open('article-a', { ...defaults, title: '正文的新标题' })
    expect(reopened.active.value).toBe('juejin')
    expect(reopened.selected.value).toEqual(['wechat', 'juejin'])
    expect(reopened.snapshot(['wechat']).wechat.desc).toBe('')
    reopened.open('article-b', defaults)
    expect(reopened.fields.value).toEqual(defaults)
    expect(reopened.selected.value).toEqual([])
    reopened.update({ title: '另一篇文章' })
    reopened.open('article-a', defaults)
    expect(reopened.fields.value.title).toBe('掘金标题')
  })

  it('persists through the real storage manager and restores after a new session', async () => {
    vi.useFakeTimers()
    const storage = new StorageManager()
    const saved = storage.reactive<PublishDraftMap>(PUBLISH_DRAFTS_KEY, {})
    await nextTick()
    const draft = createPublishDraftSession(saved)
    draft.open('article-a', defaults)
    draft.select(['wechat'])
    draft.update({ title: '关闭页面也保留', thumb: material })
    await nextTick()
    await vi.advanceTimersByTimeAsync(350)
    const nextStorage = new StorageManager()
    const reopened = createPublishDraftSession(nextStorage.reactive<PublishDraftMap>(PUBLISH_DRAFTS_KEY, {}))
    reopened.open('article-a', defaults)
    expect(reopened.fields.value).toEqual({ ...defaults, title: '关闭页面也保留', thumb: material })
    expect(JSON.stringify(saved.value)).not.toMatch(/loggedIn|content|markdown|base64/)
  })
})

describe('channel-specific COSE delivery', () => {
  const artifact = { html: '<section data-md-component="KeyFindingV1">保留组件</section><pre><code><span style="color:red">SELECT</span> 1</code></pre>', markdown: '原始 Markdown' }
  it('uses the exact article artifact for every channel and embeds a shared private cover once', async () => {
    const fetch = vi.fn(async () => ({ ok: true, blob: async () => new Blob(['image bytes'], { type: 'image/png' }) }))
    vi.stubGlobal('fetch', fetch)
    const fields = { wechat: { ...defaults, title: '微信版', thumb: material }, juejin: { ...defaults, title: '技术版', thumb: material } }
    const tasks = await buildPublishTasks(artifact, [account('wechat'), account('juejin'), { ...account('zhihu'), loggedIn: false }], fields, 'https://studio.example')
    expect(tasks).toHaveLength(2)
    expect(tasks.map(task => task.post.title)).toEqual(['微信版', '技术版'])
    expect(tasks.map(task => task.accounts[0].type)).toEqual(['wechat', 'juejin'])
    for (const task of tasks) {
      expect(task.post.content).toBe(artifact.html)
      expect(task.post.wechatHtml).toBe(artifact.html)
      expect(task.post.markdown).toBe(artifact.markdown)
      expect(task.post.images).toEqual([{ key: task.post.thumb, data: 'data:image/png;base64,aW1hZ2UgYnl0ZXM=', name: '封面' }])
    }
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fields.wechat.thumb).toBe(material)
  })

  it('keeps the same local original for inline images, references and a cover across two channels', async () => {
    const bytes = 'data:image/png;base64,Ynl0ZXM='
    const markdown = [
      `![图](${material} "说明")`,
      '![图表][report]',
      `[report]: <${material}>`,
      `示例：\`![图](${material})\``,
      '```md',
      `![示例](${material})`,
      '```',
    ].join('\n\n')
    const html = `<section data-md-component="FigureCaptionV1"><img src="${bytes}" style="width:50%"><img src="${bytes}"></section><pre><code><span style="color:red">SELECT</span></code></pre>`
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const artifact = { html, markdown, materialImages: new Map([[material, Promise.resolve(bytes)]]) }
    const fields = { ...defaults, thumb: material }
    const tasks = await buildPublishTasks(artifact, [account('wechat'), account('juejin')], { wechat: fields, juejin: fields }, 'https://studio.example')
    for (const { post } of tasks) {
      expect(post.images).toEqual([{ key: post.thumb, data: bytes, name: '正文图片' }])
      expect(post.content).toBe(html.split(bytes).join(post.thumb))
      expect(post.markdown).toContain(`![图](${post.thumb} "说明")`)
      expect(post.markdown).toContain(`[report]: ${post.thumb}`)
      expect(post.markdown).toContain(`\`![图](${material})\``)
      expect(post.markdown).toContain(`![示例](${material})`)
    }
    expect(fetch).not.toHaveBeenCalled()
    const addTask = vi.fn()
    const updates: CoseTaskStatus[] = []
    await runPublishTasks(tasks, { addTask }, status => updates.push(status))
    expect(addTask).not.toHaveBeenCalled()
    expect(updates[updates.length - 1]?.accounts.every(item => item.error?.includes('新版 COSE'))).toBe(true)
  })

  it('sends the original behind responsive and lazy previews, including picture components in Markdown', async () => {
    const bytes = 'data:image/png;base64,Ynl0ZXM='
    const artifact = {
      html: `<section data-md-component="WeChatFigureBannerV1"><picture><source srcset="/thumb.webp"><img src="/placeholder.gif" data-src="${material}" srcset="/thumb.webp" alt="报告"></picture><p>报表说明</p></section>`,
      markdown: `<WeChatFigureBannerV1 src="${material}" text="报表说明" />`,
      materialImages: new Map([[material, Promise.resolve(bytes)]]),
    }
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('should reuse the prepared original') }))
    const [task] = await buildPublishTasks(artifact, [account('juejin')], { juejin: { ...defaults, thumb: material } }, 'https://studio.example')
    const { post } = task
    expect(post.images).toHaveLength(1)
    expect(post.content).toContain('data-md-component="WeChatFigureBannerV1"')
    expect(post.content).not.toMatch(/data-src|srcset|thumb.webp|placeholder.gif/)
    expect(post.markdown).toContain(`![报告](${post.thumb})`)
    expect(post.markdown).toContain('报表说明')
  })

  it('reads external covers anonymously and stops preparation when a library image is unavailable', async () => {
    const fetch = vi.fn(async () => ({ ok: true, blob: async () => new Blob(['cover'], { type: 'image/png' }) }))
    vi.stubGlobal('fetch', fetch)
    const tasks = await buildPublishTasks(artifact, [account('wechat')], { wechat: defaults }, 'https://studio.example')
    expect(tasks[0].post.images?.[0].data).toBe('data:image/png;base64,Y292ZXI=')
    expect(fetch).toHaveBeenCalledWith(defaults.thumb, expect.objectContaining({ credentials: 'omit' }))
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })))
    await expect(buildPublishTasks(artifact, [account('wechat')], { wechat: { ...defaults, thumb: material } }, 'https://studio.example')).rejects.toThrow('素材图片加载失败')
  })

  it('submits one immutable metadata snapshot per channel and aggregates independent results', async () => {
    const tasks: CoseAddTaskData[] = await buildPublishTasks(artifact, [account('wechat'), account('juejin')], { wechat: { ...defaults, title: '微信版', thumb: '' }, juejin: { ...defaults, title: '技术版', thumb: '' } })
    const started: string[] = []
    const snapshots: CoseTaskStatus[] = []
    let finishFirst: (() => void) | undefined
    const api: CoseApi = { addTask(task, progress, complete) {
      started.push(task.post.title)
      if (task.accounts[0].type === 'wechat') {
        finishFirst = () => {
          progress({ accounts: [{ ...account('wechat'), status: 'done' }] })
          complete()
        }
      }
      else {
        throw new Error('模拟渠道失败')
      }
    } }
    const running = runPublishTasks(tasks, api, status => snapshots.push(status))
    expect(started).toEqual(['微信版'])
    finishFirst!()
    await running
    expect(started).toEqual(['微信版', '技术版'])
    expect(snapshots[snapshots.length - 1].accounts.map(item => item.status)).toEqual(['done', 'failed'])
    expect(snapshots[0].accounts.map(item => item.status)).toEqual(['pending', 'pending'])
  })
})
