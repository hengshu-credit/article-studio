import { markdownLanguage } from '@codemirror/lang-markdown'

/** Rewrite image destinations without touching prose, fenced samples or inline code. */
export function mapMarkdownImages(markdown: string, lookup: (url: string) => string | undefined) {
  const edits: { from: number, to: number, text: string }[] = []
  markdownLanguage.parser.parse(markdown).iterate({
    enter(node) {
      if (node.name === 'URL' && ['Image', 'LinkReference'].includes(node.node.parent?.name ?? '')) {
        const target = markdown.slice(node.from, node.to).replace(/^<(.*)>$/s, '$1')
        const replaced = lookup(target)
        if (replaced)
          edits.push({ from: node.from, to: node.to, text: replaced })
      }
    },
  })
  for (const edit of edits.reverse())
    markdown = markdown.slice(0, edit.from) + edit.text + markdown.slice(edit.to)
  return markdown
}
