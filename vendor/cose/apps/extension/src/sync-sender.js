// Keep large articles in the originating content script until the worker has
// read them. Even escaped Unicode fits in a runtime message at this chunk size.
const chunkSize = 4 * 1024 * 1024

export function createSyncSender(runtime) {
  const pending = new Map()
  runtime.onMessage.addListener((request, _sender, respond) => {
    if (request.type !== 'READ_SYNC_CHUNK') return
    const json = pending.get(request.id)
    if (!json || !Number.isSafeInteger(request.offset) || request.offset < 0) return
    let end = Math.min(request.offset + chunkSize, json.length)
    // Keep non-BMP characters intact across independently serialized messages.
    const last = json.charCodeAt(end - 1)
    if (last >= 0xd800 && last <= 0xdbff) end--
    respond(json.slice(request.offset, end))
  })

  return async function sendSync(platformId, content) {
    const json = JSON.stringify(content)
    if (json.length <= chunkSize)
      return runtime.sendMessage({ type: 'SYNC_TO_PLATFORM', platformId, content })

    const id = crypto.randomUUID()
    pending.set(id, json)
    try {
      return await runtime.sendMessage({
        type: 'SYNC_TO_PLATFORM', platformId, transfer: { id, length: json.length },
      })
    } finally {
      pending.delete(id)
    }
  }
}
