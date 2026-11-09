import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Material, MaterialPage, MaterialUpload } from '../src/services/materials/types.ts'
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import sharp from 'sharp'
import { MAX_MATERIAL_BYTES } from '../src/services/materials/types.ts'

const HASH_PATTERN = /^[a-f0-9]{64}$/
const MAX_PIXELS = 40_000_000
const formats = {
  png: { mime: 'image/png', extension: 'png' },
  jpeg: { mime: 'image/jpeg', extension: 'jpg' },
  gif: { mime: 'image/gif', extension: 'gif' },
  webp: { mime: 'image/webp', extension: 'webp' },
} as const

class MaterialError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function imageFormat(bytes: Buffer): keyof typeof formats {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return 'png'
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return 'jpeg'
  if (/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii')))
    return 'gif'
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP')
    return 'webp'
  throw new MaterialError(415, '仅支持 PNG、JPEG、GIF 和 WebP 图片')
}

function atomicWrite(path: string, bytes: Buffer) {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, bytes, { flag: 'wx' })
    renameSync(temporary, path)
  }
  finally {
    if (existsSync(temporary))
      unlinkSync(temporary)
  }
}

/** Metadata in SQLite; immutable originals and generated thumbnails on disk. */
export class MaterialLibrary {
  private db: DatabaseSync
  private directory: string
  private pending = new Map<string, Promise<MaterialUpload>>()

  constructor(databasePath: string) {
    this.directory = join(dirname(databasePath), 'materials')
    mkdirSync(this.directory, { recursive: true })
    this.db = new DatabaseSync(databasePath)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS materials (
        hash TEXT PRIMARY KEY, name TEXT NOT NULL, mime TEXT NOT NULL,
        size INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
        createdAt TEXT NOT NULL, url TEXT NOT NULL, thumbnailUrl TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS materials_created ON materials(createdAt DESC, hash);
    `)
  }

  get(hash: string): Material | null {
    if (!HASH_PATTERN.test(hash))
      return null
    const material = this.db.prepare('SELECT * FROM materials WHERE hash = ?').get(hash) as unknown as Material | undefined
    if (!material || !existsSync(this.filePath(material.url)) || !existsSync(this.filePath(material.thumbnailUrl)))
      return null
    return material
  }

  filePath(url: string): string {
    if (!/^\/media\/[a-f0-9]{64}(?:\.thumb)?\.(?:png|jpg|gif|webp)$/.test(url))
      throw new MaterialError(404, '素材不存在')
    return join(this.directory, basename(url))
  }

  list(search: string, offset: number, limit: number): MaterialPage {
    const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`
    const total = this.db.prepare('SELECT COUNT(*) AS count FROM materials WHERE name LIKE ? ESCAPE \'\\\'').get(pattern)!
    const stats = this.db.prepare('SELECT COALESCE(SUM(size), 0) AS bytes FROM materials').get()!
    const items = this.db.prepare('SELECT * FROM materials WHERE name LIKE ? ESCAPE \'\\\' ORDER BY createdAt DESC, hash LIMIT ? OFFSET ?').all(pattern, limit, offset) as unknown as Material[]
    return { items, total: Number(total.count), totalBytes: Number(stats.bytes), offset, limit }
  }

  async upload(bytes: Buffer, name: string, expectedHash?: string): Promise<MaterialUpload> {
    if (!bytes.length || bytes.length > MAX_MATERIAL_BYTES)
      throw new MaterialError(413, '图片不能为空，且每张不能超过 10 MB')
    const hash = createHash('sha256').update(bytes).digest('hex')
    if (expectedHash && expectedHash !== hash)
      throw new MaterialError(400, '图片校验失败，请重新上传')
    const existing = this.get(hash)
    if (existing)
      return { material: existing, reused: true }
    const pending = this.pending.get(hash)
    if (pending)
      return { ...(await pending), reused: true }
    const saving = this.save(hash, bytes, name)
    this.pending.set(hash, saving)
    try { return await saving }
    finally { this.pending.delete(hash) }
  }

  private async save(hash: string, bytes: Buffer, name: string): Promise<MaterialUpload> {
    const format = imageFormat(bytes)
    let thumbnail: Buffer
    let width: number
    let height: number
    try {
      const input = sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: 'warning' })
      const metadata = await input.metadata()
      width = metadata.width!
      height = metadata.pageHeight ?? metadata.height!
      if (metadata.orientation && metadata.orientation >= 5)
        [width, height] = [height, width]
      thumbnail = await input.rotate().resize({ width: 480, height: 360, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer()
    }
    catch {
      throw new MaterialError(415, '图片无法解码或像素过大，请使用有效的图片文件')
    }
    const material: Material = {
      hash,
      name: Array.from(basename(name.replace(/\\/g, '/'))).filter(char => char.codePointAt(0)! >= 32 && char.codePointAt(0) !== 127).join('').slice(0, 200) || `image.${formats[format].extension}`,
      mime: formats[format].mime,
      size: bytes.length,
      width,
      height,
      createdAt: new Date().toISOString(),
      url: `/media/${hash}.${formats[format].extension}`,
      thumbnailUrl: `/media/${hash}.thumb.webp`,
    }
    atomicWrite(this.filePath(material.url), bytes)
    atomicWrite(this.filePath(material.thumbnailUrl), thumbnail)
    this.db.prepare(`INSERT OR IGNORE INTO materials (hash, name, mime, size, width, height, createdAt, url, thumbnailUrl)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(hash, material.name, material.mime, material.size, width, height, material.createdAt, material.url, material.thumbnailUrl)
    return { material: this.get(hash)!, reused: false }
  }

  close() { this.db.close() }
}

export function createMaterialHandler(path: string, changed: () => void = () => {}) {
  const library = new MaterialLibrary(path)
  let activeUploads = 0
  async function handle(req: IncomingMessage, res: ServerResponse, next: () => void) {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (!url.pathname.startsWith('/api/materials') && !url.pathname.startsWith('/media/')) {
      next()
      return
    }
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Cache-Control', 'no-store')
    if (req.headers.origin && ![`http://${req.headers.host}`, `https://${req.headers.host}`].includes(req.headers.origin)) {
      res.writeHead(403).end()
      return
    }
    try {
      if (url.pathname.startsWith('/media/') && ['GET', 'HEAD'].includes(req.method ?? '')) {
        const match = /^\/media\/([a-f0-9]{64})(\.thumb)?\.(?:png|jpg|gif|webp)$/.exec(url.pathname)
        const material = match && library.get(match[1])
        if (!material || ![material.url, material.thumbnailUrl].includes(url.pathname))
          throw new MaterialError(404, '素材不存在')
        const filePath = library.filePath(url.pathname)
        res.writeHead(200, {
          'Content-Type': match![2] ? 'image/webp' : material.mime,
          'Content-Length': statSync(filePath).size,
          'Cache-Control': 'private, max-age=31536000, immutable',
          'Cross-Origin-Resource-Policy': 'same-origin',
        })
        if (req.method === 'HEAD')
          res.end()
        else
          createReadStream(filePath).on('error', () => res.destroy()).pipe(res)
        return
      }
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      if (url.pathname === '/api/materials' && req.method === 'GET') {
        const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset') ?? '0', 10) || 0)
        const limit = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '30', 10) || 30))
        res.end(JSON.stringify(library.list((url.searchParams.get('q') ?? '').slice(0, 200), offset, limit)))
        return
      }
      const hash = /^\/api\/materials\/([a-f0-9]{64})$/.exec(url.pathname)?.[1]
      if (hash && req.method === 'GET') {
        const material = library.get(hash)
        if (!material)
          throw new MaterialError(404, '素材不存在')
        res.end(JSON.stringify(material))
        return
      }
      if (url.pathname !== '/api/materials' || req.method !== 'POST')
        throw new MaterialError(404, '接口不存在')
      if (activeUploads >= 4)
        throw new MaterialError(429, '正在处理其他图片，请稍后重试')
      if (Number(req.headers['content-length']) > MAX_MATERIAL_BYTES)
        throw new MaterialError(413, '每张图片不能超过 10 MB')
      activeUploads++
      try {
        let size = 0
        const chunks: Buffer[] = []
        for await (const chunk of req) {
          size += chunk.length
          if (size > MAX_MATERIAL_BYTES)
            throw new MaterialError(413, '每张图片不能超过 10 MB')
          chunks.push(chunk)
        }
        const result = await library.upload(Buffer.concat(chunks), decodeURIComponent(String(req.headers['x-file-name'] ?? 'image')), String(req.headers['x-content-sha256'] ?? '') || undefined)
        if (!result.reused)
          changed()
        res.writeHead(result.reused ? 200 : 201).end(JSON.stringify(result))
      }
      finally { activeUploads-- }
    }
    catch (error) {
      if (res.headersSent) {
        res.destroy()
        return
      }
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.writeHead(error instanceof MaterialError ? error.status : 500).end(JSON.stringify({ error: error instanceof MaterialError ? error.message : '素材处理失败，请重试' }))
    }
  }
  return { handle, close: () => library.close() }
}
