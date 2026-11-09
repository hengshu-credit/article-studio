import type { Material } from './types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { materialPath, uploadMaterial } from './client'
import { materialMarkdown } from './types'

const hash = 'a'.repeat(64)
const material: Material = { hash, name: '测试.png', mime: 'image/png', size: 3, width: 1, height: 1, createdAt: '2026-11-09', url: `/media/${hash}.png`, thumbnailUrl: `/media/${hash}.thumb.webp` }

afterEach(() => vi.unstubAllGlobals())

describe('material uploads', () => {
  it('queries by content before uploading and skips sending duplicate bytes, independent of filename', async () => {
    const fetch = vi.fn(async (_url: string) => Response.json(material))
    vi.stubGlobal('fetch', fetch)
    await expect(uploadMaterial(new File(['abc'], 'new-name.png'))).resolves.toEqual({ material, reused: true })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toMatch(/^\/api\/materials\/[a-f0-9]{64}$/)
  })

  it('uploads raw bytes once for concurrent identical files and emits a library refresh event', async () => {
    const dispatchEvent = vi.fn()
    vi.stubGlobal('window', { dispatchEvent })
    let stored = false
    const fetch = vi.fn(async (_url: string, options?: RequestInit) => {
      if (options?.method === 'POST') {
        stored = true
        return Response.json({ material, reused: false })
      }
      return stored ? Response.json(material) : new Response(null, { status: 404 })
    })
    vi.stubGlobal('fetch', fetch)
    const results = await Promise.all([uploadMaterial(new File(['same'], 'one.png')), uploadMaterial(new File(['same'], 'two.png'))])
    expect(fetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1)
    expect(results.map(result => result.material.url)).toEqual([material.url, material.url])
    expect(dispatchEvent).toHaveBeenCalledTimes(1)
    const request = fetch.mock.calls.find(([, options]) => options?.method === 'POST')![1]!
    expect(request.body).toBeInstanceOf(File)
    expect(request.headers).toMatchObject({ 'Content-Type': 'application/octet-stream' })
  })

  it('does not upload when the metadata check is unavailable and releases a failed request for retry', async () => {
    const fetch = vi.fn(async () => new Response('unavailable', { status: 503 }))
    vi.stubGlobal('fetch', fetch)
    await expect(uploadMaterial(new File(['retry'], 'x.png'))).rejects.toThrow('素材库请求失败')
    await expect(uploadMaterial(new File(['retry'], 'x.png'))).rejects.toThrow('素材库请求失败')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('recognizes only this origin’s library URLs and escapes Markdown alt text', () => {
    expect(materialPath(material.url, 'https://studio.example')).toBe(material.url)
    expect(materialPath(`https://other.example${material.url}`, 'https://studio.example')).toBeNull()
    expect(materialMarkdown({ name: 'a] [b.png', url: material.url })).toBe(`![a\\] \\[b.png](${material.url})`)
  })
})
