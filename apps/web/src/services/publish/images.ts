import type { ArticleArtifact } from './article-artifact'
import type { CoseImage } from '@/types/cose'
import { mapMarkdownImages } from '@md/shared/editor/map-markdown-images'
import { inspectPublishMarkup } from '@md/shared/editor/publish-markup'
import { blobToDataUrl } from '@/lib/assets/blob'
import { inlineMaterialImageSource, originalImageSource } from '@/services/materials/export'
import { renderPlatformBody } from './platform-body'

/** Keep bytes out of both document templates and share each original within the batch. */
export async function preparePublishImages(artifact: Pick<ArticleArtifact, 'html' | 'markdown' | 'materialImages'>, origin: string, includeBodyImages = true) {
  const loaded = new Map(artifact.materialImages)
  const files = new Map<string, CoseImage>()
  const aliases = new Map<string, CoseImage>()
  const prefix = `studio-image-${crypto.getRandomValues(new Uint32Array(4)).join('-')}-`
  const canonical = (src: string) => new URL(src, origin).href
  async function file(src: string, name: string) {
    const url = canonical(src)
    const cached = aliases.get(url)
    if (cached)
      return cached
    let sourceUrl: string | undefined
    let data = await inlineMaterialImageSource(src, origin, loaded)
    if (!/^data:image\/[\w.+-]+;base64,[a-z\d+/=\s]+$/i.test(data)) {
      const target = new URL(url)
      if (!['http:', 'https:', 'blob:', 'data:'].includes(target.protocol))
        throw new Error('图片地址无效，请重新选择素材')
      try {
        const response = await fetch(target.href, { credentials: target.origin === origin ? 'same-origin' : 'omit', signal: AbortSignal.timeout(30000) })
        if (!response.ok)
          throw new Error(String(response.status))
        const blob = await response.blob()
        if (!blob.size || !blob.type.startsWith('image/'))
          throw new Error('无效图片')
        data = await blobToDataUrl(blob)
      }
      catch {
        if (target.origin === origin || !['https:', 'http:'].includes(target.protocol))
          throw new Error(`无法读取图片“${name}”的原文件，请下载后从素材库插入，再重新分发`)
        // Some image servers permit editor import but disallow reading bytes via CORS.
        sourceUrl = target.href
        data = ''
      }
    }
    const identity = sourceUrl || data
    let image = files.get(identity)
    if (!image) {
      image = { key: `${prefix}${files.size + 1}~`, data, name, ...(sourceUrl ? { sourceUrl } : {}) }
      files.set(identity, image)
    }
    aliases.set(url, image)
    return image
  }

  const template = document.createElement('template')
  template.innerHTML = artifact.html
  for (const img of includeBodyImages ? template.content.querySelectorAll<HTMLImageElement>('img') : []) {
    const src = originalImageSource(img)
    if (!src.trim())
      throw new Error('正文图片缺少地址，请重新选择素材')
    const image = await file(src, img.alt || '正文图片')
    img.setAttribute('src', image.key)
    for (const attr of ['srcset', 'data-src', 'data-original', 'data-srcset', 'loading'])
      img.removeAttribute(attr)
    img.closest('picture')?.querySelectorAll('source').forEach(source => source.remove())
  }
  for (const [path, bytes] of loaded) {
    const image = files.get(await bytes)
    if (image)
      aliases.set(canonical(path), image)
  }
  const bodyImages = [...files.values()]
  const html = bodyImages.length ? template.innerHTML : artifact.html
  const markup = inspectPublishMarkup(artifact.markdown)
  function prepareMarkdown() {
    if (markup.hasHtml || !artifact.markdown.trim())
      return renderPlatformBody(template.content, 'markdown', markup)
    if (!bodyImages.length)
      return artifact.markdown
    return mapMarkdownImages(artifact.markdown, (src) => {
      try { return aliases.get(canonical(src))?.key }
      catch { return undefined }
    })
  }
  let markdown: string | undefined
  let plainText: string | undefined
  return {
    async forCover(src: string, textOnly = false) {
      const cover = src ? await file(src, '封面') : undefined
      const bodyFiles = textOnly ? [] : bodyImages
      const images = cover && !bodyFiles.includes(cover) ? [...bodyFiles, cover] : bodyFiles
      const media = { thumb: cover?.key ?? '', ...(images.length ? { images } : {}) }
      if (textOnly) {
        plainText ??= renderPlatformBody(template.content, 'text', markup)
        return { ...media, markdown: plainText, content: plainText }
      }
      markdown ??= prepareMarkdown()
      return { ...media, markdown, content: html, wechatHtml: html }
    },
  }
}
