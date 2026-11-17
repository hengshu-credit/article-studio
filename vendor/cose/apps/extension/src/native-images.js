/** Serialized into the platform tab. All file handling runs against its own editor. */
export async function uploadInEditor(image, cover, expectedOrigin, timeout = 30000, requireEmptyDraft = false, knownCoverAsset = null) {
  try {
    const result = await upload()
    return typeof result === 'object' && result !== null ? { ok: true, ...result } : { ok: true, url: result }
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
        if (cover && !knownCoverAsset && !/(^|\.)qpic\.cn$/i.test(url.hostname)) throw new Error('请下载封面原图，在平台图片库中选择文件上传')
        const img = document.createElement('img')
        img.src = url.href
        transfer.setData('text/html', img.outerHTML)
      }
    }
    let fileName
    if (blob) {
      const ext = blob.type === 'image/jpeg' ? 'jpg' : blob.type.split('/')[1].split('+')[0]
      if (cover && expectedOrigin === 'https://mp.weixin.qq.com') {
        const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
        const hash = Array.from(new Uint8Array(digest).slice(0, 12), byte => byte.toString(16).padStart(2, '0')).join('')
        fileName = `cover-${hash}.${ext}`
      } else {
        fileName = `${image.name.replace(/[\\/:*?"<>|\r\n]/g, '-').slice(0, 120)}.${ext}`
      }
      transfer.items.add(new File([blob], fileName, { type: blob.type }))
    }

    function remote(raw, doc) {
      if (!raw || raw.startsWith('#')) return null
      try {
        const url = new URL(raw, doc.baseURI)
        return /^https?:$/.test(url.protocol) && (cover || blob || url.href !== image.sourceUrl) ? url.href : null
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
    // The cover has its own file and media-library selection, independent of
    // the article's image atoms. Do not change the publisher's crop settings.
    async function chooseWechatCover() {
      const area = document.querySelector('#js_cover_area')
      if (!area) throw new Error('未找到微信封面设置')
      const visible = el => el?.getClientRects().length && getComputedStyle(el).visibility !== 'hidden'
      const dialogs = () => [...document.querySelectorAll('.weui-desktop-dialog,[role=dialog]')].filter(visible)
      const heading = el => el.querySelector('h3,[role=heading]')?.textContent.trim()
      const button = (el, labels) => [...el.querySelectorAll('button,a,[role=button]')].find(b =>
        labels.includes(b.textContent.trim()) && !b.disabled && b.getAttribute('aria-disabled') !== 'true' && visible(b))
      const preview = () => {
        const el = area.querySelector('.js_cover_preview_new')
        const src = el?.style.backgroundImage.match(/^url\(["']?(https?:\/\/.*?)["']?\)$/)?.[1]
        return visible(el) && src ? loadable(src, document) : null
      }
      const previous = preview()
      for (const target of [area, area.querySelector('.select-cover__btn')].filter(Boolean)) {
        target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
        target.dispatchEvent(new MouseEvent('mouseenter'))
      }
      const options = [...area.querySelectorAll('.js_imagedialog')]
      const library = options.find(visible) || area.querySelector('.js_cover_null_pop .js_imagedialog') || options[0]
      if (!library) throw new Error('未找到微信封面的“从图片库选择”入口')
      library.click()
      const gallery = await wait(() => dialogs().find(d =>
        /图片|素材/.test(heading(d) || '') && !/从正文插入/.test(d.innerText || '')), 8000)
      if (!gallery) throw new Error('微信封面图片库未打开')

      function group(name) {
        return [...gallery.querySelectorAll('.weui-desktop-img-category__title')].find(el =>
          el.textContent.trim() === name)?.closest('a')
      }
      const currentGroup = () => gallery.querySelector('.weui-desktop-menu__link_current .weui-desktop-img-category__title')?.textContent.trim()
      const recent = group('最近使用')
      if (!recent) throw new Error('微信图片库没有显示“最近使用”分组')
      if (currentGroup() !== '最近使用') {
        recent.click()
        await wait(() => currentGroup() === '最近使用', 3000)
      }
      function asset(raw) {
        try {
          const url = new URL(raw)
          return /(^|\.)qpic\.cn$/i.test(url.hostname) ? url.hostname + url.pathname.replace(/\/\d+$/, '') : null
        } catch { return null }
      }
      const wanted = asset(knownCoverAsset || image.sourceUrl)
      const stem = fileName?.slice(0, fileName.lastIndexOf('.'))
      const tiles = () => [...gallery.querySelectorAll('.weui-desktop-img-picker__item')]
      const thumb = el => el.querySelector('.weui-desktop-img-picker__img-thumb')
      const source = tile => thumb(tile)?.style.backgroundImage.match(/^url\(["']?(.*?)["']?\)$/)?.[1]
      function findCover() {
        return tiles().find(tile => {
          const name = tile.querySelector('.weui-desktop-img-picker__img-title')?.textContent.trim()
          return (wanted && asset(source(tile)) === wanted) || (fileName && (name === fileName || name === stem))
        })
      }
      await wait(() => tiles().length || gallery.textContent.includes('暂无'), 3000)
      let tile = findCover()
      const seen = new Set()
      const pageKey = () => tiles().map(source).join('|')
      while (!tile) {
        const next = button(gallery, ['下一页'])
        const page = pageKey()
        if (!next || !page || seen.has(page)) break
        seen.add(page)
        next.click()
        if (!await wait(() => tiles().length && pageKey() !== page, 4000)) break
        tile = findCover()
      }
      if (!tile) {
        if (!blob) throw new Error('最近使用中没有匹配的封面，请在微信图片库上传原图')
        group('我的图片')?.click()
        await wait(() => currentGroup() !== '最近使用', 3000)
        let input = gallery.querySelector('input[type=file]:not(:disabled)')
        if (!input) {
          const oldInputs = new Set(document.querySelectorAll('input[type=file]'))
          const upload = button(gallery, ['上传文件', '上传图片', '本地上传', '上传'])
          if (!upload) throw new Error('未找到微信图片库内的上传入口')
          upload.click()
          input = await wait(() => gallery.querySelector('input[type=file]:not(:disabled)') ||
            [...document.querySelectorAll('input[type=file]:not(:disabled)')].find(el => !oldInputs.has(el)), 3000)
        }
        if (!input) throw new Error('微信图片库未提供可接收原图的文件控件')
        input.files = transfer.files
        input.dispatchEvent(new Event('change', { bubbles: true }))
        tile = await wait(findCover, timeout)
      }
      if (!tile) throw new Error('微信图片库尚未返回指定封面原图')
      const selection = thumb(tile) || tile
      if (!tile.matches('[aria-selected=true],.weui-desktop-img-picker__item_selected')) selection.click()
      const choose = await wait(() => button(gallery, ['确定', '确认', '下一步', '完成']), 5000)
      if (!choose) throw new Error('微信图片库尚未确认所选封面')
      choose.click()

      const accepted = await wait(() => {
        const crop = dialogs().find(d => heading(d) === '编辑封面')
        if (crop) return { crop }
        const url = preview()
        return !visible(gallery) && url && url !== previous ? { url } : null
      }, timeout)
      if (!accepted) throw new Error('微信尚未显示所选封面，请检查草稿')
      if (!accepted.crop) return accepted
      const confirm = await wait(() => button(accepted.crop, ['确认', '确定', '完成']), 8000)
      if (!confirm) return { pendingCover: true }
      confirm.click()
      const url = await wait(() => !visible(accepted.crop) && preview(), timeout)
      return url ? { url } : { pendingCover: true }
    }

    if (cover) {
      if (expectedOrigin === 'https://mp.weixin.qq.com') return chooseWechatCover()
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
    return uploaded.url
  }
}

export async function resolveBodyImages(content, upload, importsHtmlImages = false) {
  const { images, ...post } = content
  const urls = new Map()
  for (const image of images || []) {
    if (!post.body?.includes(image.key) && !post.markdown?.includes(image.key)) continue
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
