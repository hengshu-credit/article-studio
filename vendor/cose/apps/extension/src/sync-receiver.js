export async function readSyncContent(request, sender, tabs) {
  if (!request.transfer) return request.content
  const { id, length } = request.transfer
  if (!sender.tab?.id || !id || !Number.isSafeInteger(length) || length <= 0)
    throw new Error('成稿传输信息不完整，请刷新编辑器后重试')

  const target = sender.documentId ? { documentId: sender.documentId } : { frameId: sender.frameId }
  const parts = []
  let offset = 0
  while (offset < length) {
    const part = await tabs.sendMessage(sender.tab.id, { type: 'READ_SYNC_CHUNK', id, offset }, target)
    if (typeof part !== 'string' || !part.length || offset + part.length > length)
      throw new Error('成稿传输中断，请保持编辑器打开后重试')
    parts.push(part)
    offset += part.length
  }
  return JSON.parse(parts.join(''))
}

// Retry only the rejected tab operation. Retrying a platform handler can
// create a second draft after the first one has already received content.
export async function retryTabEdit(operation) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation()
    } catch (error) {
      if (attempt >= 5 || !/Tabs cannot be edited right now/i.test(error.message)) throw error
      await new Promise(resolve => setTimeout(resolve, 100 * 2 ** attempt))
    }
  }
}
