import type { Workspace, WorkspaceCommand, WorkspaceSnapshot } from '@/services/workspace/model'
import type { Post } from '@/types/post'
import { MATERIALS_CHANGED_EVENT } from '@/services/materials/types'
import { operationId, WorkspaceClient } from '@/services/workspace/client'
import { diffWorkspace, SHARED_SETTING_KEYS } from '@/services/workspace/model'
import { store } from '@/storage'
import { useEditorStore } from '@/stores/editor'
import { usePostStore } from '@/stores/post'
import { useRenderStore } from '@/stores/render'
import { useThemeStore } from '@/stores/theme'

const OUTBOX_KEY = 'article-studio-workspace-outbox'

export const useWorkspaceStore = defineStore('workspace', () => {
  const enabled = import.meta.env.VITE_SHARED_WORKSPACE === 'true'
  const ready = ref(false)
  const connected = ref(false)
  const pending = ref(false)
  const error = ref('')
  const canUndo = ref(false)
  const canRedo = ref(false)
  const applyingRemote = ref(false)
  const historyReveal = shallowRef<{ postId: string, revision: number } | null>(null)
  let client: WorkspaceClient | null = null
  let events: EventSource | null = null
  let baseline: Workspace = { posts: [] }
  let stopWatch: (() => void) | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  let started = false
  let lifecycle = 0

  const label = computed(() => error.value ? '同步失败，正在重试' : !ready.value ? '正在连接共享文章' : !connected.value ? '连接中断，修改暂存本机' : pending.value ? '正在同步' : '多端已同步')

  function localWorkspace(): Workspace {
    return {
      settings: store.snapshotValues(SHARED_SETTING_KEYS),
      posts: usePostStore().posts.map(post => ({
        id: post.id,
        title: post.title,
        content: post.content,
        parentId: post.parentId ?? null,
        createDatetime: new Date(post.createDatetime).toISOString(),
        updateDatetime: new Date(post.updateDatetime).toISOString(),
        history: post.history.map(item => ({ ...item })),
      })),
    }
  }

  function capture() {
    if (!client || applyingRemote.value)
      return
    const next = localWorkspace()
    client.edit(baseline, next)
    baseline = next
  }

  function render(workspace: Workspace, snapshot: WorkspaceSnapshot, history?: 'undo' | 'redo') {
    const posts = usePostStore()
    applyingRemote.value = true
    const changedPosts = history ? diffWorkspace(baseline, workspace).update.filter(update => update.fields.content !== undefined) : []
    const historyPost = changedPosts.find(update => update.id === posts.currentPostId) ?? changedPosts[0]
    const settingsChanged = SHARED_SETTING_KEYS.some(key => (baseline.settings?.[key] ?? null) !== (workspace.settings?.[key] ?? null))
    baseline = structuredClone(workspace)
    store.applyValues(Object.fromEntries(SHARED_SETTING_KEYS.map(key => [key, workspace.settings?.[key] ?? null])))
    const collapsed = new Map(posts.posts.map(post => [post.id, post.collapsed]))
    posts.posts = workspace.posts.map(post => ({
      ...post,
      history: post.history.map(item => ({ ...item })),
      collapsed: collapsed.get(post.id),
      createDatetime: new Date(post.createDatetime),
      updateDatetime: new Date(post.updateDatetime),
    })) as Post[]
    if (!posts.posts.some(post => post.id === posts.currentPostId))
      posts.currentPostId = posts.posts[0]?.id ?? ''
    if (historyPost) {
      posts.currentPostId = historyPost.id
      historyReveal.value = { postId: historyPost.id, revision: (historyReveal.value?.revision ?? 0) + 1 }
    }
    canUndo.value = snapshot.canUndo
    canRedo.value = snapshot.canRedo
    // Vue's queued watchers must see this guard while remote content is installed.
    void nextTick(() => { applyingRemote.value = false })
    if (settingsChanged) {
      const theme = useThemeStore()
      theme.updateCodeTheme()
      void theme.applyCurrentTheme().then(() => useRenderStore().render(useEditorStore().getContent()))
    }
  }

  async function request(command: WorkspaceCommand): Promise<WorkspaceSnapshot> {
    const response = await fetch('/api/workspace/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok)
      throw new Error((await response.json()).error ?? '无法保存共享文章')
    return response.json()
  }

  function persist(commands: WorkspaceCommand[]) {
    try {
      sessionStorage.setItem(OUTBOX_KEY, JSON.stringify(commands))
    }
    catch {
      error.value = '本机缓存空间不足，请保持页面打开直到同步完成'
    }
  }

  async function start() {
    if (!enabled || started)
      return
    started = true
    const generation = ++lifecycle
    try {
      const response = await fetch('/api/workspace', { cache: 'no-store', signal: AbortSignal.timeout(10000) })
      if (!response.ok)
        throw new Error('无法连接共享文章服务')
      let initial: WorkspaceSnapshot = await response.json()
      const local = localWorkspace()
      if (initial.workspace === null) {
        initial = await request({ id: operationId(), kind: 'seed', workspace: local })
      }
      // Keep the pre-sync library recoverable when joining an existing workspace.
      if (!await store.get('article-studio-before-shared-sync'))
        await store.setJSON('article-studio-before-shared-sync', local)
      let restored: WorkspaceCommand[] = []
      try { restored = JSON.parse(sessionStorage.getItem(OUTBOX_KEY) ?? '[]') }
      catch { /* A malformed outbox must not prevent loading the shared workspace. */ }
      if (generation !== lifecycle)
        return
      client = new WorkspaceClient({
        initial,
        pending: Array.isArray(restored) ? restored : [],
        request,
        persist,
        render,
        status(message, hasPending) {
          error.value = message
          pending.value = hasPending
        },
      })
      client.receive(initial)
      ready.value = true
      stopWatch = watch(() => JSON.stringify(localWorkspace()), capture)
      events = new EventSource('/api/workspace/events')
      events.addEventListener('materials', () => window.dispatchEvent(new Event(MATERIALS_CHANGED_EVENT)))
      events.onopen = () => {
        connected.value = true
        error.value = ''
        void client?.pump()
      }
      events.onerror = () => { connected.value = false }
      events.onmessage = (event) => {
        capture()
        client?.receive(JSON.parse(event.data))
        void client?.pump()
      }
      void client.pump()
      window.addEventListener('pagehide', flushBeforeLeave)
      window.addEventListener('beforeunload', flushBeforeLeave)
      document.addEventListener('visibilitychange', flushWhenHidden)
    }
    catch (cause) {
      if (generation !== lifecycle)
        return
      error.value = cause instanceof Error ? cause.message : '同步失败'
      started = false
      retry = setTimeout(() => { void start() }, 2000)
    }
  }

  function history(kind: 'undo' | 'redo'): boolean {
    if (!enabled)
      return false
    useEditorStore().flushContentToPostStore()
    capture()
    client?.history(kind)
    return true
  }

  function flushBeforeLeave() {
    useEditorStore().flushContentToPostStore()
    capture()
  }

  function flushWhenHidden() {
    if (document.visibilityState === 'hidden')
      flushBeforeLeave()
  }

  function close() {
    flushBeforeLeave()
    window.removeEventListener('pagehide', flushBeforeLeave)
    window.removeEventListener('beforeunload', flushBeforeLeave)
    document.removeEventListener('visibilitychange', flushWhenHidden)
    stopWatch?.()
    events?.close()
    client?.close()
    clearTimeout(retry)
    lifecycle++
    started = false
  }

  return { enabled, ready, connected, pending, error, label, canUndo, canRedo, applyingRemote, historyReveal, start, close, history }
})
