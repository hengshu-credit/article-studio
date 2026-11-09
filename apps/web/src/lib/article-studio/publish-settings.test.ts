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
      expect(task.post.thumb).toBe('data:image/png;base64,aW1hZ2UgYnl0ZXM=')
    }
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fields.wechat.thumb).toBe(material)
  })

  it('preserves direct image URLs and stops preparation when a library image is unavailable', async () => {
    const fetch = vi.fn(async () => ({ ok: false }))
    vi.stubGlobal('fetch', fetch)
    const tasks = await buildPublishTasks(artifact, [account('wechat')], { wechat: defaults }, 'https://studio.example')
    expect(tasks[0].post.thumb).toBe(defaults.thumb)
    expect(fetch).not.toHaveBeenCalled()
    await expect(buildPublishTasks(artifact, [account('wechat')], { wechat: { ...defaults, thumb: material } }, 'https://studio.example')).rejects.toThrow('素材图片加载失败')
  })

  it('submits one immutable metadata snapshot per channel and aggregates independent results', async () => {
    const tasks: CoseAddTaskData[] = await buildPublishTasks(artifact, [account('wechat'), account('juejin')], { wechat: { ...defaults, title: '微信版' }, juejin: { ...defaults, title: '技术版' } })
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
