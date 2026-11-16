import { markdownLanguage } from '@codemirror/lang-markdown'

/** Inspect syntax nodes so literal tags in code samples never trigger conversion. */
export function inspectPublishMarkup(source: string) {
  let hasHtml = false
  const diagrams = new Map<string, string[]>()
  if (source.includes('<') || /mermaid|infographic|plantuml/.test(source)) {
    markdownLanguage.parser.parse(source).iterate({
      enter(node) {
        if (['HTMLTag', 'HTMLBlock', 'Comment', 'CommentBlock', 'ProcessingInstruction', 'ProcessingInstructionBlock', 'Declaration', 'DeclarationBlock'].includes(node.name))
          hasHtml = true
        if (node.name !== 'FencedCode')
          return
        const info = node.node.getChild('CodeInfo')
        const lang = info && source.slice(info.from, info.to).trim()
        if (lang && ['mermaid', 'infographic', 'plantuml'].includes(lang)) {
          const blocks = diagrams.get(lang) ?? []
          blocks.push(node.node.getChildren('CodeText').map(line => source.slice(line.from, line.to)).join('\n'))
          diagrams.set(lang, blocks)
        }
        return false
      },
    })
  }
  return { hasHtml, diagrams }
}
