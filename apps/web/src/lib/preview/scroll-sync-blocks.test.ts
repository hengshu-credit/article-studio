// @vitest-environment jsdom
import { ARTICLE_COMPONENTS, decorateWeChatReference } from '@article-studio/article-kit'
import { initRenderer } from '@md/core/renderer'
import { postProcessHtml, renderMarkdown } from '@md/core/utils'
import { describe, expect, it } from 'vitest'
import { extractPreviewMap, mapScroll, markPreviewBlock } from './scroll-sync-blocks'

describe('source to preview map', () => {
  it('keeps actual source lines across hidden metadata, adjacent blocks, repeated titles and decorations', () => {
    const lines = [
      '---',
      'title: example',
      '---',
      '# Same',
      'First paragraph',
      '',
      '```js',
      'const x = 1',
      '',
      'const y = 2',
      '```',
      '',
      '| A | B |',
      '|---|---|',
      '| a | b |',
      '',
      '<WeChatIntroV1>',
      '',
      'Nested **body**.',
      '',
      '</WeChatIntroV1>',
      '',
      '## Same',
      '1. One',
      '2. Two',
      '',
      '[Link](https://example.com)',
    ]
    const markdown = lines.join('\r\n')
    function article(mapped: boolean) {
      const renderer = initRenderer({ countStatus: true, citeStatus: true, isMacCodeBlock: true, components: Object.fromEntries(ARTICLE_COMPONENTS.map(c => [c.name, c])) })
      const { html, readingTime } = renderMarkdown(markdown, renderer, mapped ? markPreviewBlock : undefined)
      return decorateWeChatReference(postProcessHtml(html, readingTime, renderer), true)
    }
    const result = extractPreviewMap(article(true))
    const clean = document.createElement('template')
    clean.innerHTML = article(false)
    expect(result.html).toBe(clean.innerHTML)
    const elements = clean.content.firstElementChild!.children
    expect(result.blocks.map(b => [lines[b.line - 1], elements[b.child].tagName])).toEqual([
      ['# Same', 'H1'],
      ['First paragraph', 'P'],
      ['```js', 'SECTION'],
      ['| A | B |', 'SECTION'],
      ['<WeChatIntroV1>', 'SECTION'],
      ['## Same', 'H2'],
      ['1. One', 'OL'],
      ['[Link](https://example.com)', 'P'],
    ])
    expect(elements[result.blocks[2].child].querySelector('pre .hljs-keyword')).not.toBeNull()
    expect(elements[result.blocks[4].child].querySelector('strong')?.textContent).toBe('body')
  })
})

describe('scroll interpolation', () => {
  const anchors = [{ editor: 20, preview: 180 }, { editor: 200, preview: 240 }, { editor: 850, preview: 760 }]
  const end = { editor: 800, preview: 900 }
  const at = (i: number) => anchors[i]
  it.each([[0, 0], [20, 180], [110, 210], [200, 240], [500, 570], [800, 900]])('maps %i to %i in both directions', (editor, preview) => {
    expect(mapScroll(editor, 'editor', end, anchors.length, at)).toBe(preview)
    expect(mapScroll(preview, 'preview', end, anchors.length, at)).toBe(editor)
  })
})
