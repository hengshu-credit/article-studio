// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
// @ts-expect-error COSE serializes this JavaScript function into the platform tab.
import { uploadInEditor } from '../../../../../vendor/cose/apps/extension/src/native-images.js'

const image = { data: 'data:image/png;base64,YQ==', name: '本地图' }
const url = 'https://images.example.test/native.png'
const upload = () => uploadInEditor(image, false, location.origin, 1000)
let editor: HTMLElement
let uploads: number

beforeEach(() => {
  vi.useFakeTimers()
  document.body.innerHTML = '<div class="ProseMirror" contenteditable="true" tabindex="0"><p>保留正文</p><img src="https://images.example.test/original.png"></div>'
  editor = document.querySelector<HTMLElement>('.ProseMirror')!
  Object.defineProperty(editor, 'getClientRects', { value: () => [new DOMRect()] })
  vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true)
  vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(100)
  vi.stubGlobal('DataTransfer', class { items = { add() {} } })
  vi.stubGlobal('ClipboardEvent', Event)
  uploads = 0
  editor.addEventListener('paste', () => {
    uploads++
    editor.insertAdjacentHTML('beforeend', `<figure contenteditable="false"><img src="${url}"><figcaption>图片说明</figcaption></figure>`)
  })
})

afterEach(() => {
  Reflect.deleteProperty(document, 'execCommand')
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

it('cleans only the uploaded figure, leaving the preceding paragraph intact across uploads', async () => {
  const original = editor.innerHTML
  document.execCommand = vi.fn(() => {
    // Chromium can collapse a selection around an uneditable figure and
    // backspace into the previous paragraph instead.
    const paragraph = editor.querySelector('p')!
    paragraph.textContent = paragraph.textContent.slice(0, -1)
    return true
  })
  for (let i = 0; i < 2; i++) {
    const result = upload()
    await vi.runAllTimersAsync()
    expect(await result).toEqual({ ok: true, url })
    expect(editor.innerHTML).toBe(original)
  }
  expect(uploads).toBe(2)
  expect(document.execCommand).not.toHaveBeenCalled()
})

it('waits for the editor to finish removal and ignores the uploaded node in a separate preview', async () => {
  const original = editor.innerHTML
  const remove = vi.fn((event: Event) => {
    event.preventDefault()
    setTimeout(() => document.body.append(editor.querySelector('figure')!), 180)
  })
  editor.addEventListener('beforeinput', remove)
  const result = upload()
  await vi.runAllTimersAsync()
  expect(await result).toEqual({ ok: true, url })
  expect(remove).toHaveBeenCalledTimes(1)
  expect(editor.innerHTML).toBe(original)
  expect(document.body.lastElementChild?.tagName).toBe('FIGURE')
})

it('removes the matching image atom through the editor transaction', async () => {
  const original = editor.innerHTML
  const dispatch = vi.fn(() => editor.querySelector('figure')!.remove())
  const del = vi.fn()
  Object.assign(editor, { editor: { view: {
    dom: editor, dispatch, nodeDOM: (pos: number) => pos === 9 ? editor.querySelector('figure') : editor.querySelector('img'),
    state: {
      doc: { descendants(fn: (node: object, pos: number) => void) {
        for (const pos of [3, 9]) fn({ isAtom: true, nodeSize: 1 }, pos)
      } },
      tr: { delete: del },
    },
  } } })
  document.execCommand = vi.fn(() => false)
  const result = upload()
  await vi.runAllTimersAsync()
  expect(await result).toEqual({ ok: true, url })
  expect(del).toHaveBeenCalledExactlyOnceWith(9, 10)
  expect(dispatch).toHaveBeenCalledTimes(1)
  expect(document.execCommand).not.toHaveBeenCalled()
  expect(editor.innerHTML).toBe(original)
})

it('reports the image and keeps the draft when the editor vetoes deletion', async () => {
  document.execCommand = vi.fn(() => false)
  editor.addEventListener('beforeinput', event => event.preventDefault())
  const result = upload()
  await vi.runAllTimersAsync()
  expect(await result).toMatchObject({ ok: false, error: expect.stringContaining('本地图') })
  expect(editor.querySelector('p')?.textContent).toBe('保留正文')
  expect(editor.querySelectorAll('img')).toHaveLength(2)
})

it('selects the exact uploaded original as WeChat cover before removing the staging image', async () => {
  const original = editor.innerHTML
  document.body.insertAdjacentHTML('beforeend', '<div id="js_cover_area"><button class="js_selectCoverFromContent"></button><div class="js_cover_preview_new"></div></div>')
  const source = document.querySelector<HTMLButtonElement>('.js_selectCoverFromContent')!
  const preview = document.querySelector<HTMLElement>('.js_cover_preview_new')!
  let selected = ''
  source.onclick = () => {
    expect(editor.querySelector('figure img')?.getAttribute('src')).toBe(url)
    const dialog = document.createElement('div')
    dialog.className = 'weui-desktop-dialog'
    dialog.innerHTML = '<h3>选择图片</h3><ul></ul><button disabled>下一步</button>'
    Object.defineProperty(dialog, 'getClientRects', { value: () => [new DOMRect()] })
    document.body.append(dialog)
    for (const src of ['https://images.example.test/wrong.png', url]) {
      const li = document.createElement('li')
      li.className = 'appmsg_content_img_item'
      li.innerHTML = `<span class="appmsg_content_img" style="background-image:url('${src}')"></span>`
      li.onclick = () => { selected = src; dialog.querySelector('button')!.disabled = false }
      dialog.querySelector('ul')!.append(li)
    }
    dialog.querySelector('button')!.onclick = () => {
      dialog.innerHTML = '<h3>编辑封面</h3><button>确认</button>'
      dialog.querySelector('button')!.onclick = () => {
        preview.style.backgroundImage = `url("${selected}")`
        dialog.remove()
      }
    }
  }
  const result = uploadInEditor(image, false, location.origin, 1000, false, true)
  await vi.runAllTimersAsync()
  expect(await result).toEqual({ ok: true, url })
  expect(preview.style.backgroundImage).toContain(url)
  expect(uploads).toBe(1)
  expect(editor.innerHTML).toBe(original)
})

it('restores body contents and reports failure if the requested WeChat cover cannot be selected', async () => {
  const original = editor.innerHTML
  const result = uploadInEditor(image, false, location.origin, 1000, false, true)
  await vi.runAllTimersAsync()
  expect(await result).toMatchObject({ ok: false, error: expect.stringContaining('封面') })
  expect(editor.innerHTML).toBe(original)
})
