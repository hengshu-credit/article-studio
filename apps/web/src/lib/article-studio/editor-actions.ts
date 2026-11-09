import type { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { NO_INDENT_MARKER } from '@article-studio/article-kit'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'

function selectedParagraphs(state: EditorState) {
  const { from, to, empty } = state.selection.main
  const tree = ensureSyntaxTree(state, to, 100) ?? syntaxTree(state)
  const paragraphs: { from: number, markerLength: number }[] = []
  const frontMatter = state.doc.sliceString(0).match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0].length ?? 0
  tree.iterate({
    from,
    to,
    enter(node) {
      if (node.name === `Document`)
        return
      if (node.name !== `Paragraph` || node.node.parent?.name !== `Document`)
        return false
      if (node.from < frontMatter || (empty ? from < node.from || from > node.to : node.from >= to || node.to <= from))
        return false
      const text = state.doc.sliceString(node.from, node.to)
      // Custom component tags can be parsed as paragraphs by the editor grammar.
      // Keep them, display math and image-only blocks structurally intact.
      if (/^(?:\$\$|\\\[|<\/?[A-Z][\w-]*\b)/.test(text))
        return false
      let child = node.node.firstChild
      let end = node.from
      let imagesOnly = Boolean(child)
      while (child && imagesOnly) {
        imagesOnly = !state.doc.sliceString(end, child.from).trim()
          && (child.name === `Image` || (child.name === `Link` && Boolean(child.getChild(`Image`))))
        end = child.to
        child = child.nextSibling
      }
      if (imagesOnly && !state.doc.sliceString(end, node.to).trim())
        return false
      paragraphs.push({ from: node.from, markerLength: text.startsWith(NO_INDENT_MARKER) ? NO_INDENT_MARKER.length : 0 })
      return false
    },
  })
  return paragraphs
}

export function paragraphIndentState(state: EditorState) {
  const paragraphs = selectedParagraphs(state)
  return { available: paragraphs.length > 0, noIndent: paragraphs.length > 0 && paragraphs.every(paragraph => paragraph.markerLength > 0) }
}

/** Toggle current/selected prose paragraphs in one undoable transaction. */
export function toggleParagraphIndent(view: EditorView): boolean {
  const paragraphs = selectedParagraphs(view.state)
  if (!paragraphs.length)
    return false
  const restoreDefault = paragraphs.every(paragraph => paragraph.markerLength > 0)
  const changes = view.state.changes(paragraphs.filter(paragraph => restoreDefault || !paragraph.markerLength).map(paragraph => ({
    from: paragraph.from,
    to: paragraph.from + paragraph.markerLength,
    insert: restoreDefault ? `` : NO_INDENT_MARKER,
  })))
  view.dispatch({ changes, selection: view.state.selection.map(changes), scrollIntoView: true, userEvent: `input.format` })
  view.focus()
  return true
}

/** Expand to whole lines so block formatting never inserts a marker mid-sentence. */
export function formatBlock(view: EditorView, kind: `quote` | `bullet` | `ordered` | `paragraph`) {
  const selection = view.state.selection.main
  const first = view.state.doc.lineAt(selection.from)
  const last = view.state.doc.lineAt(selection.to > selection.from && view.state.doc.lineAt(selection.to).from === selection.to ? selection.to - 1 : selection.to)
  const text = view.state.doc.sliceString(first.from, last.to)
  const lines = text.split(`\n`)
  const pattern = kind === `quote` ? /^> ?/ : kind === `bullet` ? /^[-+*] / : /^\d+\. /
  const remove = kind !== `paragraph` && lines.every(line => pattern.test(line))
  const insert = lines.map((line, index) => {
    if (kind === `paragraph`)
      return line.replace(/^#{1,6}\s+/, ``)
    if (remove)
      return line.replace(pattern, ``)
    const prefix = kind === `quote` ? `> ` : kind === `bullet` ? `- ` : `${index + 1}. `
    return prefix + line.replace(kind === `quote` ? /^> ?/ : /^(?:[-+*]|\d+\.) /, ``)
  }).join(`\n`)
  view.dispatch({ changes: { from: first.from, to: last.to, insert }, selection: { anchor: first.from, head: first.from + insert.length }, scrollIntoView: true, userEvent: `input` })
  view.focus()
}

export function insertBlock(view: EditorView, content: string, selectedBody?: string) {
  const { from, to } = view.state.selection.main
  const before = view.state.doc.sliceString(0, from)
  const after = view.state.doc.sliceString(to)
  const prefix = before && !before.endsWith(`\n\n`) ? (before.endsWith(`\n`) ? `\n` : `\n\n`) : ``
  const suffix = after && !after.startsWith(`\n\n`) ? (after.startsWith(`\n`) ? `\n` : `\n\n`) : ``
  const insert = `${prefix}${content}${suffix}`
  const bodyOffset = selectedBody ? content.indexOf(selectedBody) : -1
  const anchor = bodyOffset >= 0 ? from + prefix.length + bodyOffset : from + insert.length
  view.dispatch({ changes: { from, to, insert }, selection: { anchor, head: bodyOffset >= 0 ? anchor + selectedBody!.length : anchor }, scrollIntoView: true, userEvent: `input` })
  view.focus()
}

export function insertCodeFence(view: EditorView, language: string) {
  const selected = view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)
  const body = selected || (language === `sql` ? `SELECT *\nFROM your_table;` : language === `python` ? `print("Hello, data")` : `在这里填写代码`)
  const runs = body.match(/`+/g) ?? []
  const fence = `\``.repeat(Math.max(3, ...runs.map(run => run.length + 1)))
  insertBlock(view, `${fence}${language}\n${body}\n${fence}`, body)
}
