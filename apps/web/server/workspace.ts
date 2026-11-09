import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Workspace, WorkspaceChanges, WorkspaceCommand, WorkspaceSnapshot } from '../src/services/workspace/model.ts'
import { Buffer } from 'node:buffer'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { applyChanges, SHARED_SETTING_KEYS } from '../src/services/workspace/model.ts'

const MAX_BODY_BYTES = 16 * 1024 * 1024
const fields = new Set(['title', 'content', 'parentId'])

function validateSettings(settings: Record<string, string | null> | undefined) {
  if (settings === undefined)
    return
  if (!settings || typeof settings !== 'object' || Array.isArray(settings))
    throw new Error('排版设置无效')
  for (const [key, value] of Object.entries(settings)) {
    if (!SHARED_SETTING_KEYS.includes(key) || !(value === null || typeof value === 'string'))
      throw new Error('排版设置字段无效')
  }
}

function validateWorkspace(workspace: Workspace) {
  if (!workspace || !Array.isArray(workspace.posts) || workspace.posts.length > 10000)
    throw new Error('文章列表无效')
  validateSettings(workspace.settings)
  const ids = new Set<string>()
  for (const post of workspace.posts) {
    if (!post || typeof post.id !== 'string' || !post.id || ids.has(post.id)
      || typeof post.title !== 'string' || typeof post.content !== 'string'
      || !(post.parentId === null || typeof post.parentId === 'string')
      || !Number.isFinite(Date.parse(post.createDatetime)) || !Number.isFinite(Date.parse(post.updateDatetime))
      || !Array.isArray(post.history)
      || post.history.some(item => !item || typeof item.content !== 'string' || !['number', 'string'].includes(typeof item.datetime))) {
      throw new Error('文章内容无效')
    }
    ids.add(post.id)
  }
}

function validateChanges(changes: WorkspaceChanges) {
  if (!changes || !Array.isArray(changes.create) || !Array.isArray(changes.update) || !Array.isArray(changes.remove))
    throw new Error('操作无效')
  validateWorkspace({ posts: changes.create })
  validateSettings(changes.settings)
  if (changes.remove.some(id => typeof id !== 'string'))
    throw new Error('删除操作无效')
  for (const update of changes.update) {
    if (!update || typeof update.id !== 'string' || !update.fields || typeof update.fields !== 'object')
      throw new Error('修改操作无效')
    for (const [key, value] of Object.entries(update.fields)) {
      if (!fields.has(key) || !(typeof value === 'string' || (key === 'parentId' && value === null)))
        throw new Error('修改字段无效')
    }
  }
}

/** One authoritative state and one durable global undo/redo stack. No edit preconditions. */
export class WorkspaceDatabase {
  private db: DatabaseSync

  constructor(path: string) {
    if (path !== ':memory:')
      mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id = 1), state TEXT, sequence INTEGER NOT NULL DEFAULT 0);
      INSERT OR IGNORE INTO workspace (id) VALUES (1);
      CREATE TABLE IF NOT EXISTS undo_stack (id INTEGER PRIMARY KEY AUTOINCREMENT, before_state TEXT NOT NULL, after_state TEXT NOT NULL, undone INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY);
    `)
  }

  snapshot(acknowledged?: string): WorkspaceSnapshot {
    const row = this.db.prepare('SELECT state, sequence FROM workspace WHERE id = 1').get()!
    return {
      workspace: row.state ? JSON.parse(String(row.state)) : null,
      sequence: Number(row.sequence),
      canUndo: Boolean(this.db.prepare('SELECT 1 FROM undo_stack WHERE undone = 0 LIMIT 1').get()),
      canRedo: Boolean(this.db.prepare('SELECT 1 FROM undo_stack WHERE undone = 1 LIMIT 1').get()),
      acknowledged,
    }
  }

  execute(command: WorkspaceCommand): WorkspaceSnapshot {
    if (!command || typeof command.id !== 'string' || !command.id || command.id.length > 150)
      throw new Error('操作标识无效')
    if (this.db.prepare('SELECT 1 FROM receipts WHERE id = ?').get(command.id))
      return this.snapshot(command.id)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const before = this.snapshot().workspace
      let after = before
      if (command.kind === 'seed') {
        validateWorkspace(command.workspace!)
        if (before === null)
          after = applyChanges(command.workspace!, { create: [], update: [], remove: [] })
      }
      else if (command.kind === 'edit') {
        if (before === null)
          throw new Error('工作区尚未初始化')
        validateChanges(command.changes!)
        after = applyChanges(before, command.changes!)
        if (JSON.stringify(after) !== JSON.stringify(before)) {
          const now = new Date().toISOString()
          for (const post of after.posts) {
            const previous = before.posts.find(item => item.id === post.id)
            if (!previous || post.title !== previous.title || post.content !== previous.content || post.parentId !== previous.parentId)
              post.updateDatetime = now
          }
          this.db.prepare('DELETE FROM undo_stack WHERE undone = 1').run()
          this.db.prepare('INSERT INTO undo_stack (before_state, after_state) VALUES (?, ?)').run(JSON.stringify(before), JSON.stringify(after))
        }
      }
      else if (command.kind === 'undo' || command.kind === 'redo') {
        const undo = command.kind === 'undo'
        const row = this.db.prepare(undo
          ? 'SELECT * FROM undo_stack WHERE undone = 0 ORDER BY id DESC LIMIT 1'
          : 'SELECT * FROM undo_stack WHERE undone = 1 ORDER BY id ASC LIMIT 1').get()
        if (row) {
          after = JSON.parse(String(undo ? row.before_state : row.after_state))
          this.db.prepare('UPDATE undo_stack SET undone = ? WHERE id = ?').run(undo ? 1 : 0, row.id!)
        }
      }
      else {
        throw new Error('未知操作')
      }
      this.db.prepare('UPDATE workspace SET state = ?, sequence = sequence + 1 WHERE id = 1').run(after === null ? null : JSON.stringify(after))
      this.db.prepare('INSERT INTO receipts (id) VALUES (?)').run(command.id)
      this.db.exec('COMMIT')
      return this.snapshot(command.id)
    }
    catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  close() { this.db.close() }
}

export function createWorkspaceHandler(path: string) {
  const database = new WorkspaceDatabase(path)
  const streams = new Set<ServerResponse>()
  const send = (stream: ServerResponse, snapshot: WorkspaceSnapshot) => {
    // Bound slow readers: they reconnect and receive the latest complete state.
    if (stream.writableLength > MAX_BODY_BYTES) {
      stream.destroy()
      return
    }
    stream.write(`data: ${JSON.stringify(snapshot)}\n\n`)
  }
  const heartbeat = setInterval(() => {
    for (const stream of streams)
      stream.write(': heartbeat\n\n')
  }, 15000)
  heartbeat.unref()

  async function handle(req: IncomingMessage, res: ServerResponse, next: () => void) {
    const pathname = req.url?.split('?')[0]
    if (!pathname?.startsWith('/api/workspace')) {
      next()
      return
    }
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) {
      res.writeHead(403).end('Origin not allowed')
      return
    }
    if (pathname === '/api/workspace/events' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no' })
      res.write('retry: 1000\n\n')
      streams.add(res)
      send(res, database.snapshot())
      res.on('close', () => streams.delete(res))
      return
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    if (pathname === '/api/workspace' && req.method === 'GET') {
      res.end(JSON.stringify(database.snapshot()))
      return
    }
    if (pathname !== '/api/workspace/command' || req.method !== 'POST') {
      res.writeHead(404).end(JSON.stringify({ error: 'Not found' }))
      return
    }
    if (!req.headers['content-type']?.startsWith('application/json')) {
      res.writeHead(415).end(JSON.stringify({ error: 'Expected JSON' }))
      return
    }
    try {
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of req) {
        size += chunk.length
        if (size > MAX_BODY_BYTES) {
          res.writeHead(413).end(JSON.stringify({ error: '内容超过 16 MB' }))
          return
        }
        chunks.push(chunk)
      }
      const snapshot = database.execute(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      for (const stream of streams)
        send(stream, snapshot)
      res.end(JSON.stringify(snapshot))
    }
    catch (error) {
      res.writeHead(400).end(JSON.stringify({ error: error instanceof Error ? error.message : '保存失败' }))
    }
  }
  return {
    handle,
    notifyMaterialsChanged() {
      for (const stream of streams)
        stream.write('event: materials\ndata: {}\n\n')
    },
    close() {
      clearInterval(heartbeat)
      for (const stream of streams)
        stream.end()
      database.close()
    },
  }
}
