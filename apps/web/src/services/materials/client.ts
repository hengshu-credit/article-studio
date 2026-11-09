import type { Material, MaterialPage, MaterialUpload } from './types'
import { MATERIAL_URL_PATTERN, MATERIALS_CHANGED_EVENT, MAX_MATERIAL_BYTES } from './types'

export const materialLibraryEnabled = import.meta.env.VITE_SHARED_WORKSPACE === 'true'
const pendingUploads = new Map<string, Promise<MaterialUpload>>()

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error || '素材库请求失败，请稍后重试')
  }
  return response.json()
}

export function materialPath(source: string, origin = window.location.origin): string | null {
  try {
    const url = new URL(source, origin)
    return url.origin === origin && MATERIAL_URL_PATTERN.test(url.pathname) ? url.pathname : null
  }
  catch { return null }
}

export async function getMaterial(hash: string): Promise<Material | null> {
  const response = await fetch(`/api/materials/${hash}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) })
  return response.status === 404 ? null : readJson<Material>(response)
}

export async function listMaterials(search = '', offset = 0): Promise<MaterialPage> {
  const params = new URLSearchParams({ q: search, offset: String(offset), limit: '30' })
  return readJson<MaterialPage>(await fetch(`/api/materials?${params}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) }))
}

export async function uploadMaterial(file: File): Promise<MaterialUpload> {
  if (!file.size || file.size > MAX_MATERIAL_BYTES)
    throw new Error('图片不能为空，且每张不能超过 10 MB')
  const bytes = await file.arrayBuffer()
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
  const pending = pendingUploads.get(hash)
  if (pending)
    return { ...(await pending), reused: true }
  const uploading = (async (): Promise<MaterialUpload> => {
    // Cross-device deduplication before transferring the original image bytes.
    const existing = await getMaterial(hash)
    if (existing)
      return { material: existing, reused: true }
    const result = await readJson<MaterialUpload>(await fetch('/api/materials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name), 'X-Content-SHA256': hash },
      body: file,
      signal: AbortSignal.timeout(60000),
    }))
    window.dispatchEvent(new Event(MATERIALS_CHANGED_EVENT))
    return result
  })()
  pendingUploads.set(hash, uploading)
  try { return await uploading }
  finally { pendingUploads.delete(hash) }
}
