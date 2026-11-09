import type { Workspace, WorkspaceCommand, WorkspaceSnapshot } from './model'
import { applyChanges, diffWorkspace, hasChanges } from './model'

export function operationId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}

/** Ordered delivery with optimistic local edits; retries use the same operation id. */
export class WorkspaceClient {
  private snapshot: WorkspaceSnapshot
  private pending: WorkspaceCommand[]
  private sending = false
  private stopped = false
  private rendered = false
  private retry: ReturnType<typeof setTimeout> | undefined
  private listeners: {
    render: (workspace: Workspace, snapshot: WorkspaceSnapshot, history?: 'undo' | 'redo') => void
    status: (error: string, pending: boolean) => void
    persist: (commands: WorkspaceCommand[]) => void
  }

  private request: (command: WorkspaceCommand) => Promise<WorkspaceSnapshot>

  constructor(options: {
    initial: WorkspaceSnapshot
    pending?: WorkspaceCommand[]
    request: (command: WorkspaceCommand) => Promise<WorkspaceSnapshot>
    render: (workspace: Workspace, snapshot: WorkspaceSnapshot, history?: 'undo' | 'redo') => void
    status: (error: string, pending: boolean) => void
    persist: (commands: WorkspaceCommand[]) => void
  }) {
    this.snapshot = options.initial
    this.pending = options.pending ?? []
    this.request = options.request
    this.listeners = options
  }

  projected(): Workspace {
    let workspace = structuredClone(this.snapshot.workspace ?? { posts: [] })
    for (const command of this.pending) {
      if (command.kind === 'edit')
        workspace = applyChanges(workspace, command.changes!)
    }
    return workspace
  }

  edit(before: Workspace, after: Workspace) {
    const changes = diffWorkspace(before, after)
    if (hasChanges(changes))
      this.enqueue({ id: operationId(), kind: 'edit', changes })
  }

  history(kind: 'undo' | 'redo') {
    this.enqueue({ id: operationId(), kind })
  }

  private enqueue(command: WorkspaceCommand) {
    this.pending.push(command)
    this.listeners.persist(this.pending)
    this.listeners.status('', true)
    void this.pump()
  }

  receive(snapshot: WorkspaceSnapshot) {
    if (this.stopped)
      return
    const acknowledged = this.pending.find(command => command.id === snapshot.acknowledged)
    if (snapshot.acknowledged) {
      this.pending = this.pending.filter(command => command.id !== snapshot.acknowledged)
      this.listeners.persist(this.pending)
    }
    const changed = snapshot.sequence > this.snapshot.sequence || Boolean(acknowledged) || !this.rendered
    if (snapshot.sequence >= this.snapshot.sequence)
      this.snapshot = snapshot
    if (changed) {
      const history = acknowledged?.kind === 'undo' || acknowledged?.kind === 'redo' ? acknowledged.kind : undefined
      this.listeners.render(this.projected(), this.snapshot, history)
      this.rendered = true
    }
    this.listeners.status('', this.pending.length > 0)
  }

  async pump() {
    if (this.sending || this.stopped || !this.pending.length)
      return
    this.sending = true
    const command = this.pending[0]!
    try {
      this.receive(await this.request(command))
    }
    catch (error) {
      this.listeners.status(error instanceof Error ? error.message : '同步失败', true)
      this.retry = setTimeout(() => { void this.pump() }, 1500)
      return
    }
    finally {
      this.sending = false
    }
    void this.pump()
  }

  close() {
    this.stopped = true
    clearTimeout(this.retry)
  }
}
