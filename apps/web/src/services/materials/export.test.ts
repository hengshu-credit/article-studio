// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { inlineMaterialImages } from './export'

const url = `/media/${'a'.repeat(64)}.png`
afterEach(() => vi.unstubAllGlobals())

describe('material images in the shared article artifact', () => {
  it('embeds authenticated images once, preserves code and components, and leaves external URLs unchanged', async () => {
    const fetch = vi.fn(async () => ({ ok: true, blob: async () => new Blob(['image bytes'], { type: 'image/png' }) }))
    vi.stubGlobal('fetch', fetch)
    const html = `<section data-article-kit="v1"><h2>组件结论</h2><pre><code><span class="hljs-keyword" style="color:red">SELECT</span> 1</code></pre><img src="${url}" alt="图表" style="width:50%"><img src="https://studio.example${url}"><img src="https://other.example/external.png"></section>`
    const exported = await inlineMaterialImages(html, 'https://studio.example')
    const root = document.createElement('div')
    root.innerHTML = exported
    expect(root.querySelectorAll('img')[0].getAttribute('src')).toBe('data:image/png;base64,aW1hZ2UgYnl0ZXM=')
    expect(root.querySelectorAll('img')[1].getAttribute('src')).toBe(root.querySelectorAll('img')[0].getAttribute('src'))
    expect(root.querySelectorAll('img')[2].getAttribute('src')).toBe('https://other.example/external.png')
    expect(root.querySelector('img')!.style.width).toBe('50%')
    expect(root.querySelector('.hljs-keyword')!.textContent).toBe('SELECT')
    expect(root.querySelector('[data-article-kit] h2')!.textContent).toBe('组件结论')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(html).toContain(url)
    expect(html).not.toContain('base64')
  })

  it('fails explicitly instead of exporting a broken private image', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })))
    await expect(inlineMaterialImages(`<img src="${url}">`, 'https://studio.example')).rejects.toThrow('无法生成完整成稿')
  })
})
