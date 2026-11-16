import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveBodyImages } from '../apps/extension/src/native-images.js'

const bodyImage = { key: 'studio-image-body~', data: 'data:image/png;base64,YQ==', name: '报告' }
const cover = { key: 'studio-image-cover~', data: 'data:image/png;base64,Yg==', name: '封面' }
const html = `<section data-md-component="WeChatFigureV1"><img alt="报告" src="${bodyImage.key}" style="width:50%"><img src="${bodyImage.key}"></section><pre><code><span style="color:red">SELECT</span></code></pre>`
const content = { body: html, wechatHtml: html, markdown: `![报告](${bodyImage.key})`, thumb: cover.key, images: [bodyImage, cover] }

test('WeChat prepares a separate cover without inserting it into the article and uploads a shared cover only once', async () => {
  for (const thumb of [cover.key, bodyImage.key]) {
    const uploads = []
    const resolved = await resolveBodyImages({ ...content, thumb }, async image => {
      uploads.push(image.key)
      return `https://images.example/${image.key}.png`
    }, false, true)
    assert.deepEqual(uploads, thumb === cover.key ? [bodyImage.key, cover.key] : [bodyImage.key])
    assert.equal(resolved.body, html.replaceAll(bodyImage.key, `https://images.example/${bodyImage.key}.png`))
  }
})

test('each target uploads its own original once and only replaces its image destinations', async () => {
  for (const origin of ['https://first.example', 'https://second.example']) {
    const href = origin + '/image.png?v=1&size=large'
    const calls = []
    const result = await resolveBodyImages(content, async image => { calls.push(image); return href })
    assert.deepEqual(calls, [bodyImage])
    assert.equal(result.body, html.replaceAll(bodyImage.key, href.replace('&', '&amp;')))
    assert.equal(result.wechatHtml, result.body)
    assert.equal(result.markdown, `![报告](${href})`)
    assert.equal(result.images, undefined)
  }
  assert.equal(content.body, html)
})

test('verified HTML import handles an unreadable external original but local files require upload', async () => {
  const external = { ...bodyImage, data: '', sourceUrl: 'https://original.example/img.jpg' }
  const result = await resolveBodyImages({ ...content, images: [external] }, () => assert.fail('native HTML importer handles external URL'), true)
  assert.equal(result.body, html.replaceAll(bodyImage.key, external.sourceUrl))
  await assert.rejects(resolveBodyImages(content, async () => 'data:image/png;base64,YQ==', true), /图片地址无效/)
  await assert.rejects(resolveBodyImages(content, async () => 'blob:temporary'), /图片地址无效/)
  await assert.rejects(resolveBodyImages(content, async () => { throw new Error('上传失败') }), /上传失败/)
})
