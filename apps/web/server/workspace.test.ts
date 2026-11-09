/* eslint test/no-import-node-test: off -- Exercise the production Node SQLite runtime. */
import type { AddressInfo } from 'node:net'
import type { SharedPost, Workspace, WorkspaceCommand, WorkspaceSnapshot } from '../src/services/workspace/model.ts'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createWorkspaceHandler, WorkspaceDatabase } from './workspace.ts'

const post: SharedPost = { id: 'one', title: '原题', content: '原文', parentId: null, history: [], createDatetime: '2026-01-01T00:00:00.000Z', updateDatetime: '2026-01-01T00:00:00.000Z' }
const initial: Workspace = { posts: [post], settings: { MD__theme: 'default' } }
const edit = (id: string, fields: { title?: string, content?: string }): WorkspaceCommand => ({ id, kind: 'edit', changes: { create: [], remove: [], update: [{ id: 'one', fields }] } })

test('任一客户端撤销全局上一步，重做和新操作遵循同一个栈', () => {
  const db = new WorkspaceDatabase(':memory:')
  try {
    db.execute({ id: 'seed', kind: 'seed', workspace: initial })
    db.execute(edit('A-edit', { content: 'A 修改正文' }))
    db.execute(edit('B-edit', { title: 'B 修改标题' }))
    const cUndo = db.execute({ id: 'C-undo', kind: 'undo' })
    assert.equal(cUndo.workspace!.posts[0].title, '原题')
    assert.equal(cUndo.workspace!.posts[0].content, 'A 修改正文')
    assert.equal(db.execute({ id: 'B-undo', kind: 'undo' }).workspace!.posts[0].content, '原文')
    assert.equal(db.execute({ id: 'C-redo', kind: 'redo' }).workspace!.posts[0].content, 'A 修改正文')
    db.execute(edit('new-edit', { title: '新标题' }))
    assert.equal(db.snapshot().canRedo, false)
    assert.equal(db.execute({ id: 'no-redo', kind: 'redo' }).workspace!.posts[0].title, '新标题')
  }
  finally { db.close() }
})

test('旧客户端修改只影响所写字段；同字段按服务端收到的顺序生效', () => {
  const db = new WorkspaceDatabase(':memory:')
  try {
    db.execute({ id: 'seed', kind: 'seed', workspace: initial })
    db.execute(edit('A', { title: '新标题' }))
    db.execute(edit('B', { content: '新正文' }))
    assert.equal(db.snapshot().workspace!.posts[0].title, '新标题')
    db.execute(edit('C', { content: '最后到达' }))
    assert.equal(db.snapshot().workspace!.posts[0].content, '最后到达')
    assert.equal(db.execute({ id: 'undo', kind: 'undo' }).workspace!.posts[0].content, '新正文')
  }
  finally { db.close() }
})

test('新增、删除、排版操作均可全局撤销；删除后不会被迟到更新复活', () => {
  const db = new WorkspaceDatabase(':memory:')
  try {
    db.execute({ id: 'seed', kind: 'seed', workspace: initial })
    db.execute({ id: 'create', kind: 'edit', changes: { create: [{ ...post, id: 'two', parentId: 'one' }], update: [], remove: [] } })
    db.execute({ id: 'delete', kind: 'edit', changes: { create: [], update: [], remove: ['one'] } })
    assert.equal(db.snapshot().workspace!.posts[0].parentId, null)
    db.execute(edit('late-edit', { content: '迟到的内容' }))
    assert.equal(db.snapshot().workspace!.posts.length, 1)
    assert.equal(db.execute({ id: 'undo-delete', kind: 'undo' }).workspace!.posts.length, 2)
    db.execute({ id: 'style', kind: 'edit', changes: { create: [], update: [], remove: [], settings: { MD__theme: 'red' } } })
    assert.equal(db.snapshot().workspace!.settings!.MD__theme, 'red')
    assert.equal(db.execute({ id: 'undo-style', kind: 'undo' }).workspace!.settings!.MD__theme, 'default')
  }
  finally { db.close() }
})

test('重启保留文章、撤销栈和去重凭据；重发撤销不会回退两次', () => {
  const dir = mkdtempSync(join(tmpdir(), 'article-workspace-'))
  const path = join(dir, 'workspace.sqlite')
  let db = new WorkspaceDatabase(path)
  try {
    db.execute({ id: 'seed', kind: 'seed', workspace: initial })
    db.execute(edit('a', { title: 'A' }))
    db.execute(edit('b', { title: 'B' }))
    const undo: WorkspaceCommand = { id: 'retry-undo', kind: 'undo' }
    db.execute(undo)
    db.close()
    db = new WorkspaceDatabase(path)
    assert.equal(db.execute(undo).workspace!.posts[0].title, 'A')
    assert.equal(db.execute({ id: 'redo', kind: 'redo' }).workspace!.posts[0].title, 'B')
  }
  finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('已有工作区包括空列表不会被新客户端的本机缓存覆盖', () => {
  const db = new WorkspaceDatabase(':memory:')
  try {
    db.execute({ id: 'first', kind: 'seed', workspace: { posts: [] } })
    assert.deepEqual(db.execute({ id: 'second', kind: 'seed', workspace: initial }).workspace!.posts, [])
    assert.equal(db.snapshot().canUndo, false)
    assert.throws(() => db.execute({ id: 'bad', kind: 'edit', changes: { create: [], remove: [], update: [], settings: { openai_key: 'secret' } } }))
    assert.equal(db.snapshot().canUndo, false)
  }
  finally { db.close() }
})

test('两个独立 SSE 客户端收到编辑与全局撤销；重连收到当前状态；拒绝跨站写入', async () => {
  const handler = createWorkspaceHandler(':memory:')
  const server = createServer((req, res) => { void handler.handle(req, res, () => res.writeHead(404).end()) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const readers: ReadableStreamDefaultReader<Uint8Array>[] = []
  const connect = async () => {
    const response = await fetch(`${base}/api/workspace/events`)
    const reader = response.body!.getReader()
    readers.push(reader)
    let buffer = ''
    return async (): Promise<WorkspaceSnapshot> => {
      for (;;) {
        const end = buffer.indexOf('\n\n')
        if (end !== -1) {
          const message = buffer.slice(0, end)
          buffer = buffer.slice(end + 2)
          const data = message.split('\n').find(line => line.startsWith('data: '))
          if (data)
            return JSON.parse(data.slice(6))
        }
        else {
          const chunk = await reader.read()
          if (chunk.done)
            throw new Error('stream ended')
          buffer += new TextDecoder().decode(chunk.value)
        }
      }
    }
  }
  const send = (command: WorkspaceCommand, origin?: string) => fetch(`${base}/api/workspace/command`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(command) })
  try {
    await send({ id: 'seed', kind: 'seed', workspace: initial })
    const a = await connect()
    const b = await connect()
    await Promise.all([a(), b()])
    await send(edit('A-edit', { content: '同步后的正文' }))
    assert.equal((await a()).workspace!.posts[0].content, '同步后的正文')
    assert.equal((await b()).workspace!.posts[0].content, '同步后的正文')
    await send({ id: 'B-undo', kind: 'undo' })
    assert.equal((await a()).workspace!.posts[0].content, '原文')
    assert.equal((await b()).workspace!.posts[0].content, '原文')
    const c = await connect()
    assert.equal((await c()).workspace!.posts[0].content, '原文')
    assert.equal((await send(edit('attack', { content: 'bad' }), 'https://other.example')).status, 403)
  }
  finally {
    await Promise.all(readers.map(reader => reader.cancel()))
    handler.close()
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})
