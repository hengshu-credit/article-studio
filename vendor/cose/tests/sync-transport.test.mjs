import assert from 'node:assert/strict'
import test from 'node:test'
import { createSyncSender } from '../apps/extension/src/sync-sender.js'
import { readSyncContent, retryTabEdit } from '../apps/extension/src/sync-receiver.js'

test('messages over 64 MiB arrive intact in bounded pieces from the originating document', async () => {
  const limit = 64 * 1024 * 1024
  const prefix = JSON.stringify({ title: '实验', body: '' }).indexOf('"body":"') + '"body":"'.length
  const body = 'a'.repeat(4 * 1024 * 1024 - prefix - 1) + '😀<section>图</section>' + 'a'.repeat(limit)
  const content = { title: '实验', body, markdown: '# 实验' }
  const source = { tab: { id: 9 }, documentId: 'editor' }
  let readChunk, transferId, received
  let pieces = 0
  const tabs = {
    async sendMessage(id, request, target) {
      assert.equal(id, source.tab.id)
      assert.equal(target.documentId, source.documentId)
      let part
      readChunk(request, {}, value => { part = value })
      assert.ok(part.isWellFormed())
      assert.ok(Buffer.byteLength(JSON.stringify(part)) < limit)
      pieces++
      return part
    },
  }
  const send = createSyncSender({
    onMessage: { addListener(fn) { readChunk = fn } },
    async sendMessage(request) {
      assert.ok(Buffer.byteLength(JSON.stringify(request)) < limit)
      transferId = request.transfer.id
      received = await readSyncContent(request, source, tabs)
      return { success: true }
    },
  })
  assert.deepEqual(await send('wechat', content), { success: true })
  assert.ok(pieces > 1)
  assert.deepEqual(received, content)
  readChunk({ type: 'READ_SYNC_CHUNK', id: transferId, offset: 0 }, {}, () => assert.fail('retained completed article'))
})

test('incomplete transfers fail before dispatching to a platform', async () => {
  await assert.rejects(readSyncContent({ transfer: { id: 'cut', length: 42 } }, { tab: { id: 8 } }, {
    async sendMessage() { return undefined },
  }), /传输中断/)
})

test('tab lock retries only the failed operation and propagates unrelated errors', async () => {
  let attempts = 0
  const result = await retryTabEdit(async () => {
    if (++attempts < 3) throw new Error('Tabs cannot be edited right now (user may be dragging a tab).')
    return { id: 7 }
  })
  assert.equal(attempts, 3)
  assert.equal(result.id, 7)
  await assert.rejects(retryTabEdit(async () => { attempts++; throw new Error('Permission denied') }), /Permission denied/)
  assert.equal(attempts, 4)
})
