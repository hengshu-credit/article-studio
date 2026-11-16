import type { PostAccount } from '@md/shared/types'
import type { ArticleArtifact } from './article-artifact'
import type { PublishMetadata } from './drafts'
import type { CoseAddTaskData, CoseApi, CoseTaskStatus } from '@/types/cose'
import { preparePublishImages } from './images'

/** Keep COSE's existing single-post protocol; each channel gets its own metadata. */
export async function buildPublishTasks(artifact: Pick<ArticleArtifact, 'html' | 'markdown' | 'materialImages'>, accounts: PostAccount[], metadata: Record<string, PublishMetadata>, origin = window.location.origin): Promise<CoseAddTaskData[]> {
  const selected = accounts.filter(account => account.checked && account.loggedIn)
  if (!selected.length)
    return []
  // COSE fills Douban's share box as plain text. Its body cannot accept image uploads.
  const article = await preparePublishImages(artifact, origin, selected.some(account => account.type !== 'douban'))
  const tasks: CoseAddTaskData[] = []
  for (const account of selected) {
    const fields = metadata[account.type]
    if (!fields)
      throw new Error(`缺少 ${account.title} 的发布信息`)
    tasks.push({
      post: { ...fields, ...await article.forCover(fields.thumb, account.type === 'douban') },
      accounts: [{ ...account }],
    })
  }
  return tasks
}

/** Submit sequentially so older COSE extensions keep their platform/tab handling. */
export async function runPublishTasks(tasks: CoseAddTaskData[], api: CoseApi, onProgress: (status: CoseTaskStatus) => void): Promise<void> {
  const state: CoseTaskStatus = { accounts: tasks.flatMap(task => task.accounts.map(account => ({ ...account, status: 'pending' }))) }
  const report = () => onProgress({ accounts: state.accounts.map(account => ({ ...account })) })
  report()
  for (const task of tasks) {
    const matches = (account: { type: string, uid: string }) => task.accounts.some(target => target.type === account.type && target.uid === account.uid)
    try {
      await new Promise<void>((resolve, reject) => {
        if (!api.addTask)
          throw new Error('COSE 扩展未就绪，请加载扩展并刷新页面')
        if (task.post.images?.length && !api.nativeImages)
          throw new Error('图片上传需要新版 COSE，请重新加载本项目附带的扩展并刷新编辑器')
        let complete = false
        try {
          api.addTask(task, (status) => {
            if (complete)
              return
            state.accounts = state.accounts.map(account => matches(account) ? { ...account, ...status.accounts.find(update => update.type === account.type && update.uid === account.uid) } : account)
            report()
          }, () => { complete = true; resolve() })
        }
        catch (error) { complete = true; reject(error) }
      })
    }
    catch (cause) {
      state.accounts = state.accounts.map(account => matches(account) ? { ...account, status: 'failed', error: cause instanceof Error ? cause.message : String(cause) } : account)
      report()
    }
  }
}
