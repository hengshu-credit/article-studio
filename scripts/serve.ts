import { Buffer } from 'node:buffer'
import { createHash, timingSafeEqual } from 'node:crypto'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { createStudioHandler } from '../apps/web/server/studio.ts'

const root = fileURLToPath(new URL('../', import.meta.url))
const dist = resolve(root, 'apps/web/dist')
const username = process.env.ARTICLE_STUDIO_USER ?? 'studio'
const password = process.env.ARTICLE_STUDIO_PASSWORD
if (!password || password.length < 12)
  throw new Error('请设置至少 12 位的 ARTICLE_STUDIO_PASSWORD；生产访问需通过 HTTPS 反向代理。')
if (!existsSync(resolve(dist, 'index.html')))
  throw new Error('请先执行 pnpm build。')
const expected = createHash('sha256').update(`Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`).digest()
const workspace = createStudioHandler(resolve(process.env.ARTICLE_STUDIO_DATA_PATH ?? resolve(root, 'data/workspace.sqlite')))
const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.wasm': 'application/wasm' }

const server = createServer((req, res) => {
  const actual = createHash('sha256').update(req.headers.authorization ?? '').digest()
  if (!timingSafeEqual(expected, actual)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Article Studio", charset="UTF-8"', 'Cache-Control': 'no-store' }).end('请登录 Article Studio')
    return
  }
  void workspace.handle(req, res, () => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end()
      return
    }
    try {
      const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
      const target = resolve(dist, `.${pathname === '/' ? '/index.html' : pathname}`)
      if (!target.startsWith(`${dist}${sep}`) || !existsSync(target) || !statSync(target).isFile()) {
        res.writeHead(404).end('Not found')
        return
      }
      res.writeHead(200, { 'Content-Type': mime[extname(target)] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' })
      if (req.method === 'HEAD')
        res.end()
      else
        createReadStream(target).on('error', () => res.destroy()).pipe(res)
    }
    catch {
      res.writeHead(400).end()
    }
  })
})
server.listen(Number(process.env.PORT ?? 5173), process.env.HOST ?? '127.0.0.1', () => {
  console.log(`Article Studio listening on ${process.env.HOST ?? '127.0.0.1'}:${process.env.PORT ?? 5173}`)
})
function close() {
  workspace.close()
  server.close()
}
process.once('SIGINT', close)
process.once('SIGTERM', close)
