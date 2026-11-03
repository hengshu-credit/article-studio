import type { EditorView } from '@codemirror/view'

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
