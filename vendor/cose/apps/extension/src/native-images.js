/** Serialized into the platform tab. All file handling runs against its own editor. */
export async function uploadInEditor(image, cover, expectedOrigin, timeout = 30000) {
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
    const previousImages = new Set(editor.querySelectorAll('img'))
    const previousFigures = new Set(editor.querySelectorAll('figure'))

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
    const uploaded = await wait(() => {
      if (!cm && !textarea) {
        for (const img of editor.querySelectorAll('img')) {
          if (previousImages.has(img)) continue
          const url = loadable(img.getAttribute('data-src'), doc) || loadable(img.getAttribute('src'), doc)
          if (url) return { img, url }
        }
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

    // Remove only the staging insertion through the editor, before filling the styled article.
    if (cm) cm.replaceRange('', cm.posFromIndex(before.length), cm.posFromIndex(readText().length))
    else if (textarea) {
      editor.setRangeText('', before.length, editor.value.length, 'end')
      editor.dispatchEvent(new Event('input', { bubbles: true }))
    } else {
      const range = doc.createRange()
      if (uploaded.img) {
        const figure = uploaded.img.closest('figure')
        range.selectNode(figure && !previousFigures.has(figure) && editor.contains(figure) ? figure : uploaded.img)
      } else {
        const walker = doc.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
        let offset = before.length
        let node
        while ((node = walker.nextNode()) && offset > node.length) offset -= node.length
        if (!node) throw new Error('平台图片插入位置已变化')
        range.selectNodeContents(editor)
        range.setStart(node, offset)
      }
      selectRange(range)
      doc.execCommand('delete')
    }
    if (uploaded.img?.isConnected || readText().trim() !== before.trim())
      throw new Error('平台已上传图片，正文编辑区仍有临时内容，请检查草稿后重试')
    return uploaded.url
  }
}

export async function resolveBodyImages(content, upload, importsHtmlImages = false) {
  const { images, ...post } = content
  const urls = new Map()
  for (const image of images || []) {
    if (!post.body?.includes(image.key) && !post.markdown?.includes(image.key)) continue
    if (importsHtmlImages) {
      // These adapters import prepared HTML and independently confirm platform-side storage.
      urls.set(image.key, image.data || image.sourceUrl)
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
