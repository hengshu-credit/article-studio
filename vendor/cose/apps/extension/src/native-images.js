/** Serialized into the platform tab. All file handling runs against its own editor. */
export async function uploadInEditor(image, cover, expectedOrigin, timeout = 30000, requireEmptyDraft = false, selectWechatCover = false) {
  try {
    return { ok: true, url: await upload() }
  } catch (error) {
    return { ok: false, error: error.message }
  }

  async function upload() {
    if (location.origin !== expectedOrigin)
      throw new Error('草稿页已跳转，请重新登录目标平台')
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
    async function wait(read, limit) {
      const until = Date.now() + limit
      do {
        const result = read()
        if (result) return result
        await sleep(150)
      } while (Date.now() < until)
      return null
    }
    const transfer = new DataTransfer()
    let blob
    if (image.data) {
      // Decode locally, including in editors whose CSP disallows fetch(data:...).
      const comma = image.data.indexOf(',')
      const mime = /^data:(image\/[\w.+-]+)(?:;charset=[\w-]+)?;base64$/i.exec(image.data.slice(0, comma))?.[1]
      if (!mime) throw new Error('图片数据格式错误')
      blob = new Blob([Uint8Array.from(atob(image.data.slice(comma + 1)), c => c.charCodeAt(0))], { type: mime })
    } else {
      const url = new URL(image.sourceUrl)
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('外部图片地址无效')
      try {
        const response = await fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(5000) })
        if (response.ok) {
          const original = await response.blob()
          if (original.size && original.type.startsWith('image/')) blob = original
        }
      } catch { /* Let this platform's native image importer retrieve the URL. */ }
      if (!blob) {
        if (cover) throw new Error('请下载封面原图，在平台草稿中选择文件上传')
        const img = document.createElement('img')
        img.src = url.href
        transfer.setData('text/html', img.outerHTML)
      }
    }
    if (blob) {
      const ext = blob.type === 'image/jpeg' ? 'jpg' : blob.type.split('/')[1].split('+')[0]
      const filename = image.name.replace(/[\\/:*?"<>|\r\n]/g, '-').slice(0, 120)
      transfer.items.add(new File([blob], `${filename}.${ext}`, { type: blob.type }))
    }

    function remote(raw, doc) {
      if (!raw || raw.startsWith('#')) return null
      try {
        const url = new URL(raw, doc.baseURI)
        return /^https?:$/.test(url.protocol) && (blob || url.href !== image.sourceUrl) ? url.href : null
      } catch { return null }
    }
    const probes = new Map()
    function loadable(raw, doc) {
      const url = remote(raw, doc)
      if (!url) return null
      if (!probes.has(url)) {
        const img = doc.createElement('img')
        img.src = url
        probes.set(url, img)
      }
      const img = probes.get(url)
      return img.complete && img.naturalWidth > 0 ? url : null
    }
    if (cover) {
      // Only target explicitly identified cover controls, never a generic attachment input.
      const control = await wait(() => [...document.querySelectorAll('input[type=file]')].find(input =>
        !input.disabled && (input.closest('[class*="cover" i],[id*="cover" i],[data-testid*="cover" i]') ||
          /封面|cover/i.test([input.name, input.getAttribute('aria-label'), ...Array.from(input.labels || [], label => label.textContent)].join(' ')))
      ), 1500)
      if (!control) throw new Error('请在平台草稿中打开封面设置，选择封面原图')
      const area = control.closest('[class*="cover" i],[id*="cover" i],[data-testid*="cover" i]') || control.parentElement
      const urls = () => Array.from(area.querySelectorAll('img'), img => remote(img.getAttribute('src'), document)).filter(Boolean)
      const previous = new Set(urls())
      control.files = transfer.files
      control.dispatchEvent(new Event('input', { bubbles: true }))
      control.dispatchEvent(new Event('change', { bubbles: true }))
      if (!await wait(() => urls().some(url => !previous.has(url) && loadable(url, document)), Math.min(timeout, 8000)))
        throw new Error('封面原图已交给上传控件，请在平台草稿中确认上传或裁剪结果')
      return
    }

    function findEditor() {
      const documents = [document, ...Array.from(document.querySelectorAll('iframe'), frame => frame.contentDocument).filter(Boolean)]
      const selectors = ['.CodeMirror', '.ProseMirror[contenteditable=true],.public-DraftEditor-content,.cm-content,.vditor-reset[contenteditable=true],.editor__inner[contenteditable=true]', '[contenteditable=true],textarea']
      for (const selector of selectors) {
        for (const doc of documents) {
          const candidates = Array.from(doc.querySelectorAll(selector)).filter(el =>
            el.getClientRects().length && !el.disabled && !el.readOnly && !el.closest('[class*="title" i],[id*="title" i],textarea.CodeMirror-input') &&
            !/标题|title|摘要|描述|summary|description|搜索|search/i.test([el.id, el.name, el.getAttribute('placeholder'), el.getAttribute('aria-label'), el.getAttribute('data-placeholder')].join(' '))
          )
          if (candidates.length === 1) return candidates[0]
        }
      }
      return null
    }
    const editor = await wait(findEditor, Math.min(timeout, 10000))
    if (!editor) throw new Error('未找到平台的正文图片上传入口')
    const doc = editor.ownerDocument
    const cm = editor.CodeMirror
    const textarea = editor.tagName === 'TEXTAREA'
    const target = cm?.getInputField() || editor
    const readText = () => cm ? cm.getValue() : textarea ? editor.value : editor.textContent
    const before = readText()
    const bodyImages = () => Array.from(editor.querySelectorAll('img[src],img[data-src]'))
    const imageSource = img => img.getAttribute('data-src') || img.getAttribute('src')
    const previousImages = bodyImages()
    const previousSources = previousImages.map(imageSource)
    const wrappers = 'figure,[contenteditable="false"],[data-block="true"]'
    const previousWrappers = new Set(editor.querySelectorAll(wrappers))
    if (requireEmptyDraft && (before.trim() || previousImages.length || doc.querySelector('textarea.title-input__inner')?.value))
      throw new Error('已打开的草稿有内容，请在空白草稿中上传图片')

    target.focus()
    function selectRange(range) {
      const sel = doc.getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
    }
    if (cm) cm.setCursor(cm.posFromIndex(before.length))
    else if (textarea) editor.setSelectionRange(before.length, before.length)
    else {
      const range = doc.createRange()
      range.selectNodeContents(editor)
      range.collapse(false)
      selectRange(range)
    }
    const bodyInput = Array.from(doc.querySelectorAll('input[type=file][accept*="image"]')).find(input =>
      !input.disabled && input.closest('.editor-toolbar,.vditor-toolbar,.bytemd-toolbar,[role=toolbar]') &&
      !input.closest('[class*="cover" i],[id*="cover" i]'))
    if (blob && bodyInput) {
      bodyInput.files = transfer.files
      bodyInput.dispatchEvent(new Event('change', { bubbles: true }))
    } else {
      target.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }))
    }
    // A render may replace DOM nodes. Accept only one unambiguous insertion
    // relative to the original list, even when two URLs are identical.
    function insertedImage() {
      const current = bodyImages()
      if (current.length !== previousImages.length + 1) return null
      const added = current.filter((img, index) => !previousImages.includes(img) &&
        previousSources.every((src, i) => src === imageSource(current[i < index ? i : i + 1])))
      return added.length === 1 ? added[0] : null
    }
    const uploaded = await wait(() => {
      const img = !cm && !textarea && insertedImage()
      if (img) {
        const url = loadable(img.getAttribute('data-src'), doc) || loadable(img.getAttribute('src'), doc)
        if (url) return { img, url }
      }
      const text = readText()
      if (!text.startsWith(before)) return null
      const added = text.slice(before.length)
      const match = /^\s*!\[(?:\\.|[^\]])*\]\(\s*(?:<([^>]+)>|([^\s]+))\s*(?:["'][^"']*["'])?\s*\)\s*$/.exec(added)
      const url = loadable(match?.[1] || match?.[2], doc)
      return url ? { added, url } : null
    }, timeout)
    if (!uploaded) throw new Error(blob
      ? '平台未返回可保存的图片地址，请在目标编辑器检查文件粘贴和上传结果'
      : '平台未能转存这张外链图片，请下载后从素材库插入并重新分发')

    // WeChat's picker reads the image atoms in the current body. Select the
    // uploaded original before removing its temporary atom, even for a cover
    // which is not present in the finished article.
    async function chooseWechatCover() {
      const area = doc.querySelector('#js_cover_area')
      const open = area?.querySelector('.js_selectCoverFromContent')
      if (!open) throw new Error('未找到微信的“从正文选择”封面入口')
      const dialog = heading => [...doc.querySelectorAll('.weui-desktop-dialog')].find(el =>
        el.getClientRects().length && el.querySelector('h3')?.textContent.trim() === heading)
      const button = (el, text) => [...el.querySelectorAll('button')].find(b =>
        !b.disabled && b.textContent.trim() === text)
      function original(src) {
        try {
          const url = new URL(src, doc.baseURI)
          // WeChat serves thumbnails of the same qpic asset at /0 and /640.
          return /(^|\.)qpic\.cn$/i.test(url.hostname)
            ? url.hostname + url.pathname.replace(/\/\d+$/, '')
            : url.href
        } catch { return null }
      }
      const wanted = original(uploaded.url)
      const background = el => el?.style.backgroundImage.match(/^url\(["']?(.*?)["']?\)$/)?.[1]
      let active
      try {
        open.click()
        active = await wait(() => dialog('选择图片'), 5000)
        const item = active && await wait(() => [...active.querySelectorAll('.appmsg_content_img_item')].find(li => {
          const src = background(li.querySelector('.appmsg_content_img'))
          return src && original(src) === wanted
        }), 5000)
        if (!item) throw new Error('微信选图窗口未找到指定的封面原图')
        item.click()
        const next = await wait(() => button(active, '下一步'), 3000)
        if (!next) throw new Error('微信封面图片尚未选中')
        next.click()
        const crop = await wait(() => dialog('编辑封面'), 5000)
        if (!crop) throw new Error('微信封面裁剪窗口未打开')
        active = crop
        const confirm = await wait(() => button(crop, '确认'), 5000)
        if (!confirm) throw new Error('微信封面裁剪尚未就绪')
        confirm.click()
        if (!await wait(() => !dialog('编辑封面') && background(area.querySelector('.js_cover_preview_new')), 8000))
          throw new Error('微信未确认封面裁剪结果')
      } catch (error) {
        if (active?.getClientRects().length) button(active, '取消')?.click()
        throw error
      }
    }
    let coverError
    if (selectWechatCover) {
      try { await chooseWechatCover() } catch (error) { coverError = error }
    }

    function insertionRange() {
      if (!editor.isConnected) return null
      const range = doc.createRange()
      if (uploaded.img) {
        let node = insertedImage()
        if (!node || !['data-src', 'src'].some(attr => remote(node.getAttribute(attr), doc) === uploaded.url)) return null
        for (let parent = node.parentElement; parent && parent !== editor; parent = parent.parentElement) {
          if (!parent.matches(wrappers) || previousWrappers.has(parent) || parent.querySelectorAll('img').length !== 1) continue
          // A re-rendered wrapper may now enclose pre-existing text as well.
          range.selectNodeContents(editor)
          range.setEndBefore(parent)
          const prefix = range.toString()
          range.selectNodeContents(editor)
          range.setStartAfter(parent)
          if ((prefix + range.toString()).trim() === before.trim()) node = parent
        }
        range.selectNode(node)
      } else {
        if (readText() !== before + uploaded.added) return null
        const walker = doc.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
        let offset = before.length
        let node
        while ((node = walker.nextNode()) && offset >= node.length) offset -= node.length
        if (!node) throw new Error('平台图片插入位置已变化')
        range.selectNodeContents(editor)
        range.setStart(node, offset)
        if (range.cloneContents().querySelector('img,video,audio,iframe')) return null
      }
      return range
    }

    // For atom images the visual selection can be inside a non-editable node.
    // Delete the corresponding model node so a re-render cannot bring it back.
    const view = editor.editor?.view || editor.pmViewDesc?.view
    function deleteModelImage() {
      if (!uploaded.img || view?.dom !== editor || !view.state?.doc) return false
      const range = insertionRange()
      if (!range) return false
      const stagingNode = range.startContainer.childNodes[range.startOffset]
      let removal
      view.state.doc.descendants((node, pos) => {
        if (node.isText) return
        const dom = view.nodeDOM(pos)
        if (dom === stagingNode || dom === uploaded.img ||
          (node.isAtom && dom?.contains(uploaded.img) && dom.querySelectorAll?.('img').length === 1))
          removal = [pos, pos + node.nodeSize]
        if (removal) return false
      })
      if (!removal) return false
      view.dispatch(view.state.tr.delete(...removal))
      return true
    }
    function restored() {
      if (!editor.isConnected) return false
      if (cm || textarea) return readText() === before
      const current = bodyImages()
      return current.length === previousSources.length &&
        current.every((img, index) => imageSource(img) === previousSources[index]) &&
        readText().trim() === before.trim()
    }

    if (cm || textarea) {
      if (readText() === before + uploaded.added) {
        if (cm) cm.replaceRange('', cm.posFromIndex(before.length), cm.posFromIndex(before.length + uploaded.added.length))
        else {
          editor.setRangeText('', before.length, before.length + uploaded.added.length, 'end')
          editor.dispatchEvent(new Event('input', { bubbles: true }))
        }
      }
    } else if (!deleteModelImage()) {
      target.focus()
      const range = insertionRange()
      if (range) {
        selectRange(range)
        // Chrome's execCommand('delete') can backspace into the preceding
        // paragraph when the range encloses a contenteditable=false figure.
        // Let the editor handle the edit; otherwise remove the exact range.
        const init = { bubbles: true, inputType: 'deleteContentBackward' }
        const event = new InputEvent('beforeinput', {
          ...init, cancelable: true, targetRanges: [new StaticRange(range)],
        })
        if (target.dispatchEvent(event)) {
          const remaining = insertionRange()
          if (remaining && !view) {
            remaining.deleteContents()
            target.dispatchEvent(new InputEvent('input', init))
          } else if (remaining && uploaded.added && view?.dom === editor) {
            const from = view.posAtDOM(remaining.startContainer, remaining.startOffset)
            const to = view.posAtDOM(remaining.endContainer, remaining.endOffset)
            if (to > from && view.state.doc.textBetween(from, to, '\n') === uploaded.added)
              view.dispatch(view.state.tr.delete(from, to))
          }
        }
      }
    }
    // Allow editor transactions, mutation observers and delayed renders to settle.
    await sleep(50)
    if (!await wait(restored, 1500))
      throw new Error(`图片“${image.name}”已上传，编辑器未确认临时内容清理完成，请检查当前草稿`)
    if (coverError) throw coverError
    return uploaded.url
  }
}

export async function resolveBodyImages(content, upload, importsHtmlImages = false, includeCover = false) {
  const { images, ...post } = content
  const urls = new Map()
  for (const image of images || []) {
    if (!post.body?.includes(image.key) && !post.markdown?.includes(image.key) && !(includeCover && image.key === post.thumb)) continue
    if (importsHtmlImages && image.sourceUrl) {
      // These adapters can import CORS-restricted external URLs and confirm native storage.
      urls.set(image.key, image.sourceUrl)
    } else {
      const url = new URL(await upload(image))
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error('平台图片地址无效')
      urls.set(image.key, url.href.replace(/[()]/g, c => c === '(' ? '%28' : '%29'))
    }
  }
  if (!urls.size) return post
  // Substitute in one pass so long articles with many originals aren't repeatedly copied.
  const keys = [...urls.keys()].map(key => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const pattern = new RegExp(keys.join('|'), 'g')
  const htmlUrl = key => urls.get(key).replaceAll('&', '&amp;').replaceAll('"', '&quot;')
  post.body = post.body?.replace(pattern, htmlUrl)
  post.wechatHtml = post.wechatHtml?.replace(pattern, htmlUrl)
  post.markdown = post.markdown?.replace(pattern, key => urls.get(key))
  return post
}
