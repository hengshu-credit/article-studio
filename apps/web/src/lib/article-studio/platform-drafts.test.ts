// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
// @ts-expect-error COSE platform adapters are shipped as plain JavaScript.
import { syncBilibiliContent } from '../../../../../vendor/cose/packages/core/src/platforms/bilibili.js'
// @ts-expect-error COSE platform adapters are shipped as plain JavaScript.
import { fillZhihuContent } from '../../../../../vendor/cose/packages/core/src/platforms/zhihu.js'

const banner = '<section data-md-component="WeChatFigureBannerV1"><img src="https://example.test/banner.png"><p>开篇标语</p></section>'
const html = banner + '<img src="https://example.test/plot.png">'.repeat(65) + '<pre><code><span style="color:red">SELECT</span></code></pre>'

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('MouseEvent', Event)
  vi.stubGlobal('DataTransfer', class extends Map<string, string> {
    setData(type: string, data: string) { this.set(type, data) }
    getData(type: string) { return this.get(type) }
  })
  vi.stubGlobal('ClipboardEvent', class extends Event {
    clipboardData: DataTransfer
    constructor(type: string, init: EventInit & { clipboardData: DataTransfer }) {
      super(type, init)
      this.clipboardData = init.clipboardData
    }
  })
})

afterEach(() => {
  document.body.replaceChildren()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

it.each([65, 66])('Zhihu pastes the expanded component and checks the saved draft with %i images', async (count) => {
  document.body.innerHTML = '<textarea placeholder="标题"></textarea><div class="public-DraftEditor-content" contenteditable="true" tabindex="0"></div>'
  const editor = document.querySelector<HTMLElement>('[contenteditable]')!
  let pasted: string | undefined
  editor.addEventListener('paste', event => {
    pasted = event.clipboardData!.getData('text/html')
    editor.innerHTML = pasted
  })
  vi.stubGlobal('waitFor', async (selector: string) => document.querySelector(selector))
  vi.stubGlobal('setInputValue', (el: HTMLInputElement, value: string) => { el.value = value })
  vi.stubGlobal('location', { pathname: '/p/123/edit' })
  const draft = '<img src="https://pic1.zhimg.com/plot.png">'.repeat(count)
  vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ title: '文章', content: draft }) }))
  const pending = fillZhihuContent('文章', '<WeChatFigureBannerV1 />', html, true)
  await vi.runAllTimersAsync()
  expect(pasted).toBe(html)
  const result = await pending
  expect(result.success).toBe(count === 66)
  if (count === 65) expect(result.error).toContain('已确认 65 张，原文 66 张')
})

it.each([1, 2])('Bilibili saves only after the delayed final image returns status %i', async (status) => {
  document.body.innerHTML = '<div class="editor-container"><div class="ProseMirror" contenteditable="true"></div></div><textarea class="title-input__inner"></textarea><div class="extension-suffix"><span class="counter">0</span><span class="save-tip">编辑中</span></div><div class="publish-footer"><div class="footer-right"><button>保存为草稿</button></div></div>'
  const editor = document.querySelector<HTMLElement>('.ProseMirror')!
  const allImages: { attrs: { status: number } }[] = []
  Object.assign(editor, { editor: { storage: { biliImage: { allImages } } } })
  editor.addEventListener('paste', event => {
    editor.innerHTML = event.clipboardData!.getData('text/html')
    document.querySelector('.counter')!.textContent = '10'
    allImages.push(...Array.from(editor.querySelectorAll('img'), () => ({ attrs: { status: 1 } })))
    allImages[65].attrs.status = 0
    setTimeout(() => { allImages[65].attrs.status = status }, 45000)
  })
  const save = vi.fn(() => { document.querySelector('.save-tip')!.textContent = '已保存' })
  document.querySelector('button')!.onclick = save
  const pending = syncBilibiliContent({ id: 7 }, { title: '文章', body: html }, {
    waitForTab: async () => {},
    chrome: { scripting: { executeScript: async ({ func, args }: { func: (...values: string[]) => unknown, args: string[] }) => [{ result: await func(...args) }] } },
  })
  await vi.advanceTimersByTimeAsync(31000)
  expect(save).not.toHaveBeenCalled()
  await vi.runAllTimersAsync()
  const result = await pending
  expect(result.success).toBe(status === 1)
  expect(save).toHaveBeenCalledTimes(status === 1 ? 1 : 0)
  if (status === 2) expect(result.message).toContain('65/66 张，1 张失败')
})
