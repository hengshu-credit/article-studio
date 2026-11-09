import { blobToDataUrl } from '@/lib/assets/blob'
import { MATERIAL_URL_PATTERN } from './types'

/** Resolve a library image for a delivery field without leaking its private URL. */
export async function inlineMaterialImageSource(source: string, origin = window.location.origin, loaded = new Map<string, Promise<string>>()): Promise<string> {
  let url: URL
  try { url = new URL(source, origin) }
  catch { return source }
  if (url.origin !== origin || !MATERIAL_URL_PATTERN.test(url.pathname))
    return source
  let dataUrl = loaded.get(url.pathname)
  if (!dataUrl) {
    dataUrl = (async () => {
      const response = await fetch(`${origin}${url.pathname}`, { credentials: 'same-origin', signal: AbortSignal.timeout(30000) })
      if (!response.ok)
        throw new Error('素材图片加载失败，无法生成完整成稿；请检查素材库或重新上传图片')
      const blob = await response.blob()
      if (!blob.size || !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(blob.type))
        throw new Error('素材图片格式异常，请重新上传后生成成稿')
      return blobToDataUrl(blob)
    })()
    loaded.set(url.pathname, dataUrl)
  }
  return dataUrl
}

/** Only the final artifact embeds bytes. Drafts, sync and undo keep short references. */
export async function inlineMaterialImages(html: string, origin = window.location.origin): Promise<string> {
  const root = document.createElement('div')
  root.innerHTML = html
  const loaded = new Map<string, Promise<string>>()
  for (const img of root.querySelectorAll('img')) {
    const source = img.getAttribute('src')
    if (!source)
      continue
    const dataUrl = await inlineMaterialImageSource(source, origin, loaded)
    if (dataUrl !== source) {
      img.setAttribute('src', dataUrl)
      img.removeAttribute('srcset')
    }
  }
  return root.innerHTML
}
