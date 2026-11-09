/* eslint test/no-import-node-test: off -- Test the production SQLite/filesystem runtime. */
import type { AddressInfo } from 'node:net'
import type { Material, MaterialUpload } from '../src/services/materials/types.ts'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import sharp from 'sharp'
import { MaterialLibrary } from './materials.ts'
import { createStudioHandler } from './studio.ts'

async function fixture(width = 900, color = '#1565c0') {
  return sharp({ create: { width, height: 600, channels: 4, background: color } }).png().toBuffer()
}

test('内容相同而文件名不同、并发上传只保存一份；原图和缩略图分离', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'article-materials-'))
  const library = new MaterialLibrary(join(dir, 'workspace.sqlite'))
  try {
    const bytes = await fixture()
    const results = await Promise.all([library.upload(bytes, '截图.png'), library.upload(bytes, '改名.png')])
    assert.equal(results[0].material.hash, results[1].material.hash)
    assert.equal(results.filter(result => !result.reused).length, 1)
    assert.equal(library.list('', 0, 30).total, 1)
    assert.equal(library.list('', 0, 30).totalBytes, bytes.length)
    assert.deepEqual(readFileSync(library.filePath(results[0].material.url)), bytes)
    const thumb = await sharp(readFileSync(library.filePath(results[0].material.thumbnailUrl))).metadata()
    assert.equal(thumb.format, 'webp')
    assert.ok(thumb.width! <= 480)
    assert.ok(thumb.height! <= 360)
    assert.equal(readdirSync(join(dir, 'materials')).length, 2)
    assert.equal((await library.upload(bytes, 'third.png')).reused, true)
  }
  finally { library.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('素材重启可查询，名称搜索和分页准确；丢失文件可由再次上传修复', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'article-materials-'))
  const path = join(dir, 'workspace.sqlite')
  let library = new MaterialLibrary(path)
  try {
    const bytes = await fixture()
    const first = await library.upload(bytes, '../report_100%.png')
    await library.upload(await fixture(700, '#c62828'), '图表.png')
    assert.equal(first.material.name, 'report_100%.png')
    assert.equal(library.list('100%', 0, 30).total, 1)
    assert.equal(library.list('_', 0, 30).total, 1)
    assert.equal(library.list('', 1, 1).items.length, 1)
    library.close()
    library = new MaterialLibrary(path)
    assert.equal(library.get(first.material.hash)?.url, first.material.url)
    unlinkSync(library.filePath(first.material.url))
    assert.equal(library.get(first.material.hash), null)
    assert.equal((await library.upload(bytes, 'repair.png')).material.hash, first.material.hash)
    assert.deepEqual(readFileSync(library.filePath(first.material.url)), bytes)
    assert.equal(library.list('', 0, 30).total, 2)
  }
  finally { library.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('JPEG、GIF、WebP 保留原始字节并生成可解码的 WebP 缩略图', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'article-materials-formats-'))
  const library = new MaterialLibrary(join(dir, 'workspace.sqlite'))
  try {
    const png = await fixture()
    for (const format of ['jpeg', 'gif', 'webp'] as const) {
      const bytes = await sharp(png).toFormat(format).toBuffer()
      const { material } = await library.upload(bytes, `image.${format}`)
      assert.equal(material.mime, `image/${format}`)
      assert.deepEqual(readFileSync(library.filePath(material.url)), bytes)
      const thumbnail = await sharp(readFileSync(library.filePath(material.thumbnailUrl))).metadata()
      assert.equal(thumbnail.format, 'webp')
      assert.equal(material.width, 900)
      assert.equal(material.height, 600)
    }
    assert.equal(library.list('', 0, 30).total, 3)
  }
  finally { library.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('验证实际图片内容、大小和哈希，不接受伪装扩展名或越界文件路径', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'article-materials-'))
  const library = new MaterialLibrary(join(dir, 'workspace.sqlite'))
  try {
    await assert.rejects(library.upload(Buffer.from('<svg onload="alert(1)"></svg>'), 'image.png'), /仅支持/)
    await assert.rejects(library.upload(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), 'broken.png'), /无法解码/)
    await assert.rejects(library.upload(Buffer.alloc(10 * 1024 * 1024 + 1), 'huge.png'), /10 MB/)
    await assert.rejects(library.upload(await fixture(), 'valid.png', '0'.repeat(64)), /校验失败/)
    assert.throws(() => library.filePath('/media/../../workspace.sqlite'), /不存在/)
    assert.equal(library.list('', 0, 30).total, 0)
  }
  finally { library.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('HTTP 上传、跨客户端查询和文件读取；素材变更广播不产生文章撤销步骤', { timeout: 15000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'article-materials-http-'))
  const studio = createStudioHandler(join(dir, 'workspace.sqlite'))
  const server = createServer((req, res) => { void studio.handle(req, res, () => res.writeHead(404).end()) })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    const response = await fetch(`${base}/api/workspace/events`)
    reader = response.body!.getReader()
    await reader.read()
    const bytes = await fixture()
    const hash = createHash('sha256').update(bytes).digest('hex')
    assert.equal((await fetch(`${base}/api/materials/${hash}`)).status, 404)
    const uploaded = await fetch(`${base}/api/materials`, { method: 'POST', headers: { 'X-File-Name': encodeURIComponent('测试图.png'), 'X-Content-SHA256': hash }, body: bytes })
    assert.equal(uploaded.status, 201)
    const result = await uploaded.json() as MaterialUpload
    assert.equal(result.material.hash, hash)
    const event = new TextDecoder().decode((await reader.read()).value)
    assert.match(event, /event: materials/)
    const state = await (await fetch(`${base}/api/workspace`)).json() as { sequence: number, canUndo: boolean }
    assert.equal(state.sequence, 0)
    assert.equal(state.canUndo, false)
    const listed = await (await fetch(`${base}/api/materials?q=${encodeURIComponent('测试')}`)).json() as { items: Material[], total: number }
    assert.equal(listed.total, 1)
    assert.equal(listed.items[0].url, result.material.url)
    const image = await fetch(`${base}${result.material.url}`)
    assert.equal(image.headers.get('content-type'), 'image/png')
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), bytes)
    assert.equal((await fetch(`${base}${result.material.thumbnailUrl}`, { method: 'HEAD' })).headers.get('content-type'), 'image/webp')
    const repeated = await fetch(`${base}/api/materials`, { method: 'POST', body: bytes })
    assert.equal((await repeated.json() as MaterialUpload).reused, true)
    assert.equal((await fetch(`${base}/api/materials`, { method: 'POST', headers: { Origin: 'https://elsewhere.example' }, body: bytes })).status, 403)
  }
  finally {
    await reader?.cancel()
    studio.close()
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    rmSync(dir, { recursive: true, force: true })
  }
})
