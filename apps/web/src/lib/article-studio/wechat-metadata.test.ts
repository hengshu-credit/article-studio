// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
// @ts-expect-error COSE serializes this JavaScript function into WeChat's editor tab.
import { saveWechatDraft } from '../../../../../vendor/cose/packages/core/src/platforms/wechat.js'

let digest: HTMLTextAreaElement
let model: string
let saved: string[]

beforeEach(() => {
  vi.useFakeTimers()
  document.body.innerHTML = `<div id="js_cover_area"><div class="js_cover_preview_new" style="background-image:url('https://images.test/cover')"></div></div>
    <div id="js_description_span"><textarea name="digest" id="js_description" max-length="120">默认正文</textarea><em class="frm_counter">4/120</em></div>
    <div class="ProseMirror" data-cose-wechat-body><p>正文</p></div><button>保存为草稿</button>`
  digest = document.querySelector('textarea')!
  Object.defineProperty(document.querySelector('.js_cover_preview_new'), 'getClientRects', { value: () => [new DOMRect()] })
  model = digest.value
  saved = []
  digest.onkeyup = () => {
    model = digest.value
    document.querySelector('.frm_counter')!.textContent = `${Math.ceil(model.replace(/[^\x00-\xFF]/g, 'xx').length / 2)}/120`
  }
  document.querySelector('button')!.onclick = () => { saved.push(model) }
})
afterEach(() => { document.body.replaceChildren(); vi.useRealTimers() })

async function save(description: string, cover = true) {
  const result = saveWechatDraft(description, cover ? 'https://images.test/cover' : null)
  await vi.runAllTimersAsync()
  return result
}

it('saves the channel description into the platform model verbatim at its mixed-width limit', async () => {
  const text = '中'.repeat(100) + 'A'.repeat(40)
  expect(await save(text)).toMatchObject({ success: true })
  expect(saved).toEqual([text])
})

it('takes the longest prefix at the platform limit, including text after punctuation', async () => {
  const full = `精确的描述。第二句${'长'.repeat(130)}`
  expect(await save(full)).toMatchObject({ success: true, notice: expect.stringContaining('120') })
  expect(await save('', false)).toMatchObject({ success: true })
  expect(saved).toEqual([full.slice(0, 120), full.slice(0, 120)])
})

it('reads the limit from the platform field and does not split a surrogate pair', async () => {
  digest.setAttribute('max-length', '4')
  expect(await save('AB中文🎉')).toMatchObject({ success: true, notice: expect.stringContaining('4') })
  expect(saved).toEqual(['AB中文'])
})

it('does not report a successful save when the cover is missing or the digest counter rejected the edit', async () => {
  document.querySelector('.js_cover_preview_new')!.remove()
  expect(await save('指定摘要')).toMatchObject({ success: false, error: expect.stringContaining('封面') })
  digest.onkeyup = null
  expect(await save('指定的渠道摘要', false)).toMatchObject({ success: false, error: expect.stringContaining('摘要') })
  expect(saved).toEqual([])
})
