import { WECHAT_REFERENCE_PRESET } from '@article-studio/article-kit'
import { nextTick } from 'vue'
import { inspectArticleHtml, makeArticleDocument, wrapArticleHtml } from '@/lib/article-studio/artifact-html'
import { processClipboardContent } from '@/services/export/clipboard'
import { inlineMaterialImages } from '@/services/materials/export'
import { useEditorStore } from '@/stores/editor'
import { useRenderStore } from '@/stores/render'
import { useThemeStore } from '@/stores/theme'

export interface ArticleArtifact {
  html: string
  plainText: string
  markdown: string
  title: string
  document: string
  warnings: string[]
  hasPendingAsyncContent: false
}

let building = false

/** All delivery paths consume this exact HTML, including the isolated draft preview. */
export async function buildArticleArtifact(): Promise<ArticleArtifact> {
  if (building)
    throw new Error(`正在生成成稿，请稍候再试`)
  building = true
  try {
    const theme = useThemeStore()
    const markdown = useEditorStore().getContent()
    await theme.applyCurrentTheme()
    theme.updateCodeTheme()
    useRenderStore().render(markdown, { force: true, themeMode: `light` })
    await nextTick()
    const result = await processClipboardContent(theme.primaryColor)
    if (useEditorStore().getContent() !== markdown)
      throw new Error(`内容已更新，请重新生成成稿`)
    if (result.hasPendingAsyncContent)
      throw new Error(`图表或公式仍在渲染，请等待完成后重试`)
    if (!result.html.trim())
      throw new Error(`预览尚未就绪，无法生成成稿`)
    const imageHtml = await inlineMaterialImages(result.html)
    if (useEditorStore().getContent() !== markdown)
      throw new Error(`内容已更新，请重新生成成稿`)
    const html = wrapArticleHtml(imageHtml, {
      fontFamily: theme.fontFamily,
      fontSize: theme.fontSize,
      lineHeight: theme.lineHeight,
      referenceTheme: theme.articlePresetId === WECHAT_REFERENCE_PRESET,
    })
    const title = document.querySelector(`#output h1`)?.textContent || `未命名文章`
    return {
      html,
      title,
      markdown,
      plainText: result.plainText,
      document: makeArticleDocument(title, html, theme.articlePresetId === WECHAT_REFERENCE_PRESET ? 20 : 16),
      warnings: inspectArticleHtml(html),
      hasPendingAsyncContent: false,
    }
  }
  finally {
    building = false
  }
}
