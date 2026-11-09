/** Shared document state. Sequence numbers order delivery, never gate user edits. */
export interface SharedPost {
  id: string
  title: string
  content: string
  parentId: string | null
  createDatetime: string
  updateDatetime: string
  history: { datetime: number | string, content: string }[]
}

export interface Workspace {
  posts: SharedPost[]
  settings?: Record<string, string | null>
}

// Article presentation only. Credentials, navigation and device preferences stay local.
export const SHARED_SETTING_KEYS = [
  'article-studio:preset',
  'MD__theme',
  'MD__themeSettings',
  'MD__use_indent',
  'MD__use_justify',
  'isCiteStatus',
  'isCountStatus',
  'legend',
  'previewWidth',
  'MD__css_content_config',
  'MD__custom_components',
  'MD__marketplace_installed_themes',
  'MD__marketplace_installed_components',
]

export interface WorkspaceSnapshot {
  workspace: Workspace | null
  sequence: number
  canUndo: boolean
  canRedo: boolean
  acknowledged?: string
}

export interface WorkspaceChanges {
  create: SharedPost[]
  update: { id: string, fields: Partial<Pick<SharedPost, 'title' | 'content' | 'parentId'>> }[]
  remove: string[]
  settings?: Record<string, string | null>
}

export interface WorkspaceCommand {
  id: string
  kind: 'edit' | 'undo' | 'redo' | 'seed'
  changes?: WorkspaceChanges
  workspace?: Workspace
}

export function diffWorkspace(before: Workspace, after: Workspace): WorkspaceChanges {
  const previous = new Map(before.posts.map(post => [post.id, post]))
  const nextIds = new Set(after.posts.map(post => post.id))
  const changes: WorkspaceChanges = { create: [], update: [], remove: [] }
  for (const post of after.posts) {
    const old = previous.get(post.id)
    if (!old) {
      changes.create.push(structuredClone(post))
      continue
    }
    const fields: WorkspaceChanges['update'][number]['fields'] = {}
    for (const field of ['title', 'content', 'parentId'] as const) {
      if (post[field] !== old[field])
        fields[field] = post[field] as string
    }
    if (Object.keys(fields).length)
      changes.update.push({ id: post.id, fields })
  }
  changes.remove = before.posts.filter(post => !nextIds.has(post.id)).map(post => post.id)
  for (const key of SHARED_SETTING_KEYS) {
    const value = after.settings?.[key] ?? null
    if (value !== (before.settings?.[key] ?? null)) {
      changes.settings ??= {}
      changes.settings[key] = value
    }
  }
  return changes
}

export function hasChanges(changes: WorkspaceChanges): boolean {
  return Boolean(changes.create.length || changes.update.length || changes.remove.length || Object.keys(changes.settings ?? {}).length)
}

/** Field-level writes preserve unrelated edits. For the same field, arrival order wins. */
export function applyChanges(workspace: Workspace, changes: WorkspaceChanges): Workspace {
  const next = structuredClone(workspace)
  if (changes.settings)
    next.settings = { ...next.settings, ...changes.settings }
  const removed = new Set(changes.remove)
  next.posts = next.posts.filter(post => !removed.has(post.id))
  for (const post of changes.create) {
    if (!next.posts.some(existing => existing.id === post.id))
      next.posts.push(structuredClone(post))
  }
  for (const { id, fields } of changes.update) {
    const post = next.posts.find(post => post.id === id)
    if (post)
      Object.assign(post, fields)
  }
  const ids = new Set(next.posts.map(post => post.id))
  for (const post of next.posts) {
    if (post.parentId && !ids.has(post.parentId))
      post.parentId = null
    const visited = new Set([post.id])
    let parentId = post.parentId
    while (parentId) {
      if (visited.has(parentId)) {
        post.parentId = null
        break
      }
      visited.add(parentId)
      parentId = next.posts.find(candidate => candidate.id === parentId)?.parentId ?? null
    }
  }
  return next
}
