import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

test('prepared WeChat HTML reaches the real COSE message bridge without clipboard substitution', async () => {
  const sent = []
  let listener
  let clipboardReads = 0
  const window = {
    dispatchEvent() {},
    addEventListener(type, fn) { if (type === 'message') listener = fn },
    postMessage(message) {
      if (message.source !== 'cose-page') return
      sent.push(message)
      queueMicrotask(() => listener({
        source: window,
        data: { source: 'cose-extension', requestId: message.requestId, result: { success: true } },
      }))
    },
  }
  const document = { querySelector() { throw new Error('Prepared HTML must not trigger the copy button') } }
  vm.runInNewContext(readFileSync(new URL('../apps/extension/src/inject.js', import.meta.url), 'utf8'), {
    window, document,
    navigator: { clipboard: { read() { clipboardReads++; throw new Error('Clipboard unavailable') } } },
    console: { log() {}, warn() {}, error() {} }, setTimeout() {},
    CustomEvent: class { constructor(type) { this.type = type } },
  })
  const html = '<section data-article-kit="v1" style="color:#245b83"><p>exact draft</p></section>'
  await new Promise(resolve => window.$cose.addTask({
    post: { title: 'Article', content: html, wechatHtml: html, markdown: '# Article' },
    accounts: [{ uid: 'wechat', type: 'wechat', checked: true }],
  }, () => {}, resolve))
  const sync = sent.find(message => message.type === 'SYNC_TO_PLATFORM')
  assert.ok(sync)
  assert.equal(sync.payload.content.wechatHtml, html)
  assert.equal(sync.payload.content.body, html)
  assert.equal(sync.payload.content.markdown, '# Article')
  assert.equal(clipboardReads, 0)
})
