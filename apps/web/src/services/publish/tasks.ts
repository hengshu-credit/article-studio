import type { PostAccount } from '@md/shared/types'
import type { ArticleArtifact } from './article-artifact'
import type { PublishMetadata } from './drafts'
import type { CoseAddTaskData, CoseApi, CoseTaskStatus } from '@/types/cose'
import { inlineMaterialImageSource } from '@/services/materials/export'

/** Keep COSE's existing single-post protocol; each channel gets its own metadata. */
export async function buildPublishTasks(artifact: Pick<ArticleArtifact, 'html' | 'markdown'>, accounts: PostAccount[], metadata: Record<string, PublishMetadata>, origin = window.location.origin): Promise<CoseAddTaskData[]> {
  const loaded = new Map<string, Promise<string>>()
  const tasks: CoseAddTaskData[] = []
  for (const account of accounts) {
    if (!account.checked || !account.loggedIn)
      continue
    const fields = metadata[account.type]
    if (!fields)
      throw new Error(`缺少 ${account.title} 的发布信息`)
    tasks.push({
      post: { ...fields, thumb: await inlineMaterialImageSource(fields.thumb, origin, loaded), content: artifact.html, wechatHtml: artifact.html, markdown: artifact.markdown },
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
