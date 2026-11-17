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

const wxOrigin = 'https://mp.weixin.qq.com'

function galleryFixture({ crop = false, empty = false } = {}) {
  vi.stubGlobal('location', { origin: wxOrigin })
  const files: File[] = []
  vi.stubGlobal('DataTransfer', class { files = files; items = { add(f: File) { files.push(f) } } })
  const area = document.createElement('div')
  area.id = 'js_cover_area'
  area.innerHTML = '<div class="select-cover__btn"></div><div class="js_cover_null_pop"><a class="js_imagedialog">从图片库选择</a></div><div class="js_cover_preview_new" style="display:none;background-image:url(&quot;&quot;)"></div>'
  document.body.append(area)
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
    return (this.isConnected && this.style.display !== 'none' ? [new DOMRect()] : []) as unknown as DOMRectList
  })
  let selected = ''
  let registeredFile: File | undefined
  const coverSource = 'https://mmbiz.qpic.cn/mmbiz_png/coverAsset/0?wx_fmt=png'
  const gallery = document.createElement('div')
  gallery.className = 'weui-desktop-dialog'
  gallery.innerHTML = '<h3>选择图片</h3><a><strong class="weui-desktop-img-category__title">最近使用</strong></a><a class="weui-desktop-menu__link_current"><strong class="weui-desktop-img-category__title">我的图片</strong></a><div class="tiles"></div><input type="file"><a class="next">下一页</a><button>下一步</button>'
  const input = gallery.querySelector('input')!
  Object.defineProperty(input, 'files', { writable: true, value: null })
  function renderTile(name: string, src: string) {
    gallery.querySelector('.tiles')!.innerHTML = `<div class="weui-desktop-img-picker__item"><i class="weui-desktop-img-picker__img-thumb" style="background-image:url('${src}')"></i><strong class="weui-desktop-img-picker__img-title"></strong></div>`
    gallery.querySelector('.weui-desktop-img-picker__img-title')!.textContent = name
    gallery.querySelector<HTMLElement>('i')!.onclick = () => { selected = src }
  }
  const hover = vi.fn()
  area.addEventListener('mouseenter', hover)
  area.querySelector<HTMLElement>('.js_imagedialog')!.onclick = () => document.body.append(gallery)
  const groups = Array.from(gallery.querySelectorAll('a')).slice(0, 2)
  for (const link of groups) {
    link.onclick = () => {
      gallery.querySelector('.weui-desktop-menu__link_current')?.classList.remove('weui-desktop-menu__link_current')
      link.classList.add('weui-desktop-menu__link_current')
      renderTile('未命名图片', 'https://mmbiz.qpic.cn/mmbiz_png/unrelated/300')
    }
  }
  const next = vi.fn(() => {
    renderTile('未命名图片', 'https://mmbiz.qpic.cn/mmbiz_png/coverAsset/300')
    gallery.querySelector('.next')!.remove()
  })
  gallery.querySelector<HTMLElement>('.next')!.onclick = next
  input.onchange = () => {
    registeredFile = input.files![0]
    renderTile(registeredFile.name, coverSource)
  }
  const preview = area.querySelector<HTMLElement>('.js_cover_preview_new')!
  function applyCover() {
    if (!empty && selected) {
      preview.style.display = 'block'
      preview.style.backgroundImage = `url("${url}")`
    }
    gallery.remove()
  }
  const confirm = vi.fn(applyCover)
  gallery.querySelector('button')!.onclick = () => {
    if (crop) {
      gallery.innerHTML = '<h3>编辑封面</h3><button>确认</button>'
      gallery.querySelector('button')!.onclick = confirm
    } else {
      applyCover()
    }
  }
  return { coverSource, next, confirm, hover, uploaded: () => registeredFile }
}

it('selects an unnamed matching cover on the second Recently used page without cropping or touching the body', async () => {
  const original = editor.innerHTML
  const fixture = galleryFixture()
  const pending = uploadInEditor(image, true, wxOrigin, 1000, false, fixture.coverSource)
  await vi.runAllTimersAsync()
  expect(await pending).toEqual({ ok: true, url })
  expect(fixture.hover).toHaveBeenCalled()
  expect(fixture.next).toHaveBeenCalledOnce()
  expect(fixture.confirm).not.toHaveBeenCalled()
  expect(fixture.uploaded()).toBeUndefined()
  expect(editor.innerHTML).toBe(original)
  expect(uploads).toBe(0)
})

it('uploads a cover absent from the article and gallery and confirms only a required default crop', async () => {
  const fixture = galleryFixture({ crop: true })
  const pending = uploadInEditor(image, true, wxOrigin, 1000)
  await vi.runAllTimersAsync()
  expect(await pending).toEqual({ ok: true, url })
  expect(fixture.confirm).toHaveBeenCalledOnce()
  expect(fixture.uploaded()?.type).toBe('image/png')
  expect(fixture.uploaded()?.size).toBe(1)
  expect(uploads).toBe(0)
})

it('does not mistake a hidden empty cover background for a successful selection', async () => {
  const fixture = galleryFixture({ empty: true })
  const pending = uploadInEditor(image, true, wxOrigin, 1000)
  await vi.waitFor(() => expect(fixture.uploaded()).toBeDefined())
  await vi.runAllTimersAsync()
  expect(await pending).toMatchObject({ ok: false, error: expect.stringContaining('封面') })
})
