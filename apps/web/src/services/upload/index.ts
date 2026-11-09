import { materialLibraryEnabled, uploadMaterial } from '@/services/materials/client'

export async function fileUpload(content: string, file: File): Promise<string> {
  if (materialLibraryEnabled)
    return (await uploadMaterial(file)).material.url
  const { fileUpload: upload } = await import(`./providers`)
  return upload(content, file)
}
