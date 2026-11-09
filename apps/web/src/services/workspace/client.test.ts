import type { Workspace, WorkspaceCommand, WorkspaceSnapshot } from './model'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceClient } from './client'
import { applyChanges, diffWorkspace } from './model'

const original: Workspace = { posts: [{ id: 'one', title: '标题', content: '正文', parentId: null, history: [], createDatetime: '2026-01-01', updateDatetime: '2026-01-01' }] }
const snapshot = (sequence: number, workspace = original, acknowledged?: string): WorkspaceSnapshot => ({ sequence, workspace, canUndo: sequence > 1, canRedo: false, acknowledged })

describe('shared workspace delivery', () => {
  it('reveals a history result only once when SSE and HTTP acknowledge the same undo', async () => {
    let resolveRequest!: (value: WorkspaceSnapshot) => void
    let sent!: WorkspaceCommand
    const render = vi.fn()
    const client = new WorkspaceClient({ initial: snapshot(1), render, status: vi.fn(), persist: vi.fn(), request(command) { sent = command; return new Promise((resolve) => { resolveRequest = resolve }) } })
    client.receive(snapshot(1))
    client.history('undo')
    const result = snapshot(2, original, sent.id)
    client.receive(result)
    expect(render.mock.lastCall![2]).toBe('undo')
    resolveRequest(result)
    await Promise.resolve()
    client.receive(snapshot(1))
    expect(render).toHaveBeenCalledTimes(2)
    client.close()
  })

  it('retries a failed request with the same id, without generating a second undo step', async () => {
    vi.useFakeTimers()
    const request = vi.fn()
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockImplementationOnce(async (command: WorkspaceCommand) => snapshot(2, original, command.id))
    const status = vi.fn()
    const client = new WorkspaceClient({ initial: snapshot(1), request, status, render: vi.fn(), persist: vi.fn() })
    try {
      client.history('undo')
      await Promise.resolve()
      expect(status.mock.lastCall![0]).toBe('connection lost')
      await vi.advanceTimersByTimeAsync(1500)
      expect(request).toHaveBeenCalledTimes(2)
      expect(request.mock.calls[1][0].id).toBe(request.mock.calls[0][0].id)
      expect(status.mock.lastCall).toEqual(['', false])
    }
    finally {
      client.close()
      vi.useRealTimers()
    }
  })

  it('preserves queued local edits while receiving another client’s change, and ignores stale HTTP snapshots', async () => {
    let resolveRequest!: (snapshot: WorkspaceSnapshot) => void
    let sent!: WorkspaceCommand
    const render = vi.fn()
    const client = new WorkspaceClient({ initial: snapshot(1), render, status: vi.fn(), persist: vi.fn(), request(command) { sent = command; return new Promise((resolve) => { resolveRequest = resolve }) } })
    const local = structuredClone(original)
    local.posts[0].content = '本地正在输入'
    client.edit(original, local)
    const remote = structuredClone(original)
    remote.posts[0].title = '其他端改题'
    client.receive(snapshot(2, remote))
    expect(render.mock.lastCall![0].posts[0]).toMatchObject({ title: '其他端改题', content: '本地正在输入' })
    const accepted = applyChanges(remote, sent.changes!)
    client.receive(snapshot(3, accepted, sent.id))
    const newest = structuredClone(accepted)
    newest.posts[0].title = '更晚的标题'
    client.receive(snapshot(4, newest))
    resolveRequest(snapshot(3, accepted, sent.id))
    await Promise.resolve()
    expect(render.mock.lastCall![0].posts[0]).toMatchObject({ title: '更晚的标题', content: '本地正在输入' })
    client.close()
  })

  it('queues undo after the client’s pending edit and restores an outbox without changing operation ids', async () => {
    const requests: WorkspaceCommand[] = []
    const resolvers: ((snapshot: WorkspaceSnapshot) => void)[] = []
    const persist = vi.fn()
    const client = new WorkspaceClient({ initial: snapshot(1), render: vi.fn(), status: vi.fn(), persist, request(command) { requests.push(command); return new Promise(resolve => resolvers.push(resolve)) } })
    const local = structuredClone(original)
    local.posts[0].content = '修改'
    client.edit(original, local)
    client.history('undo')
    expect(requests.map(command => command.kind)).toEqual(['edit'])
    resolvers[0](snapshot(2, local, requests[0].id))
    await Promise.resolve()
    expect(requests.map(command => command.kind)).toEqual(['edit', 'undo'])
    const outbox = structuredClone(persist.mock.lastCall![0])
    client.close()
    const retry = vi.fn(async (command: WorkspaceCommand) => snapshot(3, original, command.id))
    const recovered = new WorkspaceClient({ initial: snapshot(2, local), pending: outbox, render: vi.fn(), status: vi.fn(), persist: vi.fn(), request: retry })
    await recovered.pump()
    expect(retry.mock.calls[0][0].id).toBe(requests[1].id)
    recovered.close()
  })

  it('does not turn timestamp/history maintenance into a global undo step', () => {
    const local = structuredClone(original)
    local.posts[0].updateDatetime = '2026-02-01'
    local.posts[0].history.push({ datetime: 1, content: 'history' })
    expect(diffWorkspace(original, local)).toEqual({ create: [], update: [], remove: [] })
  })

  it('tracks article styling, and preserves unrelated document fields', () => {
    const before = { ...original, settings: { MD__theme: 'default' } }
    const after = { ...original, settings: { MD__theme: 'red' } }
    const changes = diffWorkspace(before, after)
    expect(changes.settings).toEqual({ MD__theme: 'red' })
    expect(applyChanges(before, changes)).toEqual(after)
  })
})
