import { generatePureHTML } from '@md/core/utils'
import { sanitizeTitle } from '@md/shared/utils/basicHelpers'
import { downloadFile } from '@md/shared/utils/fileHelpers'
import { buildArticleArtifact } from '@/services/publish/article-artifact'

/** Export rendered HTML content. */
export async function exportHTML(title: string = `untitled`) {
  const artifact = await buildArticleArtifact()
  downloadFile(artifact.document, `${sanitizeTitle(title)}.html`, `text/html`)
}

export { generatePureHTML }

/** Export unstyled HTML file. */
export async function exportPureHTML(raw: string, title: string = `untitled`) {
  const safeTitle = sanitizeTitle(title)
  const pureHtml = await generatePureHTML(raw)
  downloadFile(pureHtml, `${safeTitle}.html`, `text/html`)
}
