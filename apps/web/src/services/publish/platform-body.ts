import type { inspectPublishMarkup } from '@md/shared/editor/publish-markup'
import { fromDom } from 'hast-util-from-dom'
import { toMdast } from 'hast-util-to-mdast'
import { toText } from 'hast-util-to-text'
import { gfmToMarkdown } from 'mdast-util-gfm'
import { mathToMarkdown } from 'mdast-util-math'
import { toMarkdown } from 'mdast-util-to-markdown'

/** Project the rendered content, including values supplied through component props. */
export function renderPlatformBody(template: DocumentFragment, format: 'markdown' | 'text', markup: ReturnType<typeof inspectPublishMarkup>): string {
  const root = template.cloneNode(true) as DocumentFragment
  root.querySelectorAll('.mac-sign, .line-numbers, [aria-hidden="true"], [hidden], style, script').forEach(el => el.remove())
  for (const number of root.querySelectorAll('.wechat-heading-number'))
    number.append(' ')

  // Recover the code column without gutters, highlight spans or layout whitespace.
  for (const code of root.querySelectorAll('pre > code')) {
    const lines = code.querySelector('.code-scroll > div, .code-block__inner') ?? code
    for (const lineBreak of lines.querySelectorAll('br'))
      lineBreak.replaceWith('\n')
    for (const line of lines.querySelectorAll(':scope > span[style*="display:block"]'))
      line.append('\n')
    code.textContent = lines.textContent.replace(/\u00A0/g, ' ')
  }
  for (const [lang, blocks] of markup.diagrams) {
    root.querySelectorAll(`.${lang}-diagram`).forEach((diagram, index) => {
      if (blocks[index] === undefined)
        return
      const pre = document.createElement('pre')
      const code = document.createElement('code')
      code.className = `language-${lang}`
      code.textContent = blocks[index]
      pre.append(code)
      diagram.replaceWith(pre)
    })
  }
  for (const formula of root.querySelectorAll('[data-math-raw]')) {
    const raw = formula.getAttribute('data-math-raw')!.trim()
    const math = document.createElement('math')
    math.setAttribute('display', formula.getAttribute('data-math-display') === 'true' ? 'block' : 'inline')
    const delimiters = [['$$', '$$'], ['$', '$'], ['\\(', '\\)'], ['\\[', '\\]']]
    const pair = delimiters.find(([open, close]) => raw.startsWith(open) && raw.endsWith(close))
    math.textContent = pair ? raw.slice(pair[0].length, -pair[1].length).trim() : raw
    formula.replaceWith(math)
  }
  for (const svg of root.querySelectorAll('svg'))
    svg.replaceWith(svg.getAttribute('aria-label') || svg.querySelector('title')?.textContent || [...svg.querySelectorAll('text')].map(el => el.textContent).join(' '))

  if (format === 'text') {
    for (const img of root.querySelectorAll('img'))
      img.replaceWith(img.alt || '图片')
    for (const link of root.querySelectorAll('a[href]')) {
      const href = link.getAttribute('href')!
      if (/^https?:\/\//i.test(href) && link.textContent.trim() !== href)
        link.append(`（${href}）`)
    }
    return toText(fromDom(root)).trim()
  }

  // The editor paints list markers as text. Markdown supplies its own markers.
  for (const item of root.querySelectorAll('li.listitem')) {
    const first = item.firstChild
    if (first?.nodeType === Node.TEXT_NODE)
      first.textContent = first.textContent?.replace(item.parentElement?.tagName === 'OL' ? /^\d+\. / : /^• /, '') ?? ''
  }
  const tree = toMdast(fromDom(root), {
    nodeHandlers: { comment: () => undefined },
    handlers: {
      math: (_, node) => ({ type: node.properties.display === 'block' ? 'math' : 'inlineMath', value: toText(node) }),
    },
  })
  return toMarkdown(tree, { bullet: '-', fences: true, extensions: [gfmToMarkdown(), mathToMarkdown()] }).trim()
}
