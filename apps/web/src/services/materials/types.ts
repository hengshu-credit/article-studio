export interface Material {
  hash: string
  name: string
  mime: string
  size: number
  width: number
  height: number
  createdAt: string
  url: string
  thumbnailUrl: string
}

export interface MaterialPage {
  items: Material[]
  total: number
  totalBytes: number
  offset: number
  limit: number
}

export interface MaterialUpload {
  material: Material
  reused: boolean
}

export const MATERIALS_CHANGED_EVENT = 'article-studio:materials-changed'
export const MAX_MATERIAL_BYTES = 10 * 1024 * 1024
export const MATERIAL_URL_PATTERN = /^\/media\/([a-f0-9]{64})\.(png|jpg|gif|webp)$/

export function materialMarkdown(material: Pick<Material, 'name' | 'url'>): string {
  const alt = material.name.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]').replace(/[\r\n]/g, ' ')
  return `![${alt}](${material.url})`
}
