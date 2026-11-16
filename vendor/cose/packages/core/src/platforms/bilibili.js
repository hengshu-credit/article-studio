const BilibiliPlatform = {
  id: 'bilibili',
  name: 'Bilibili',
  icon: 'https://www.bilibili.com/favicon.ico',
  url: 'https://member.bilibili.com',
  publishUrl: 'https://member.bilibili.com/york/read-editor',
  title: 'B站专栏',
  type: 'bilibili',
}

// chrome.scripting serializes this function into the editor's main world.
async function fillBilibiliDraftInPage(title, html) {
  async function waitFor(read, timeout) {
    const until = Date.now() + timeout
    do {
      const value = read()
      if (value) return value
      await new Promise(resolve => setTimeout(resolve, 150))
    } while (Date.now() < until)
    return null
  }

  const editor = await waitFor(
    () => document.querySelector('.editor-container .ProseMirror[contenteditable="true"]'),
    15000
  )
  if (!editor) return { success: false, message: 'B站正文编辑器未就绪，请确认已登录并可创建专栏' }

  const titleInput = document.querySelector('textarea.title-input__inner')
  const counter = document.querySelector('.extension-suffix .counter')
  const wordCount = () => Number.parseInt(counter?.textContent, 10)
  const draftButton = Array.from(
    document.querySelectorAll('.publish-footer .footer-right button')
  ).find(button =>
    ['保存为草稿', '儲存為草稿', 'Save as draft'].includes(button.textContent.trim())
  )
  if (!titleInput || !counter || !draftButton) {
    return { success: false, message: 'B站专栏缺少可用的标题、字数统计或草稿按钮' }
  }
  const images = () => editor.editor?.storage?.biliImage?.allImages || []
  if (wordCount() !== 0 || titleInput.value || editor.textContent?.trim() || images().length) {
    return { success: false, message: 'B站打开的草稿已有内容，已停止写入' }
  }

  titleInput.value = title
  titleInput.dispatchEvent(new Event('input', { bubbles: true }))

  // Use the same HTML paste path as Bilibili's document importer. This
  // updates Tiptap's document, the platform word count and its image pipeline.
  editor.focus()
  const data = new DataTransfer()
  data.setData('text/html', html)
  data.setData('text/plain', '')
  editor.dispatchEvent(
    new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data })
  )
  const source = document.createElement('template')
  source.innerHTML = html
  const expected = source.content.querySelectorAll('img[src]').length
  const imageOnly = expected > 0 && !source.content.textContent.trim()
  if (!(await waitFor(() => wordCount() > 0 || (imageOnly && images().length >= expected), 5000))) {
    return { success: false, message: 'B站未识别正文（字数为 0），已停止保存' }
  }

  if (expected > 0) {
    let uploaded = 0
    let failed = 0
    const settled = await waitFor(() => {
      const current = images()
      uploaded = current.filter(image => image.attrs.status === 1).length
      failed = current.filter(image => image.attrs.status != null && ![0, 1].includes(image.attrs.status)).length
      return failed > 0 || (current.length >= expected && uploaded === current.length)
    }, Math.min(180000, 30000 + expected * 2500))
    if (!settled || failed) {
      return { success: false, message: `B站图片已上传 ${uploaded}/${expected} 张，${failed ? `${failed} 张失败` : '其余图片尚未确认'}。请在当前编辑页检查后保存` }
    }
  }

  const saveTip = () => document.querySelector('.extension-suffix .save-tip')
  const previousTip = saveTip()?.textContent
  if (!(await waitFor(() => !draftButton.disabled, 5000)))
    return { success: false, message: 'B站草稿保存按钮暂不可用，请在当前编辑页检查' }
  draftButton.click()
  const confirmed = await waitFor(() => {
    const tip = saveTip()
    return tip?.textContent && tip.textContent !== previousTip && tip
  }, 15000)
  if (!confirmed) return { success: false, message: 'B站尚未确认草稿保存，请在编辑器中检查' }
  if (confirmed.classList.contains('save-fail'))
    return { success: false, message: confirmed.textContent }
  return { success: true, message: 'B站已确认保存专栏草稿' }
}

async function syncBilibiliContent(tab, content, { chrome, waitForTab, images }) {
  await waitForTab(tab.id)
  if (images?.prepare) content = await images.prepare(tab)
  const html = content.wechatHtml || content.body
  if (!html?.trim()) return { success: false, message: '没有可同步到B站的正文' }
  const [frame] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    func: fillBilibiliDraftInPage,
    args: [content.title || '', html],
  })
  return {
    ...(frame?.result || { success: false, message: 'B站编辑器未返回同步结果' }),
    tabId: tab.id,
  }
}

export { BilibiliPlatform, syncBilibiliContent }
