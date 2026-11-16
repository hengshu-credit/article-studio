import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

test('each channel receives one copy of the prepared HTML without clipboard substitution', async () => {
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
  const platforms = ['wechat', 'baijiahao', 'zhihu', 'bilibili', 'toutiao', 'cnblogs']
  const html = '<section data-md-component="WeChatFigureBannerV1"><img src="data:image/png;base64,abcd"></section><pre><code><span style="color:#245b83">SELECT</span> 1</code></pre>'
  await new Promise(resolve => window.$cose.addTask({
    post: { title: 'Article', content: html, wechatHtml: html, markdown: '# Article' },
    accounts: platforms.map(uid => ({ uid, type: uid, checked: true })),
  }, () => {}, resolve))
  const requests = sent.filter(message => message.type === 'SYNC_TO_PLATFORM')
  assert.equal(requests.length, platforms.length)
  for (const { payload: { platformId, content } } of requests) {
    assert.equal(content.wechatHtml, null)
    assert.equal(content.body, html)
    assert.equal(content.markdown, '# Article')
    if (platformId === 'zhihu') assert.equal(content.preparedHtml, true)
  }
  assert.equal(clipboardReads, 0)
})
