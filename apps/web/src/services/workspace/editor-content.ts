import type { EditorView } from '@codemirror/view'
import { Transaction } from '@codemirror/state'

/** Apply only the changed range, so a remote edit does not send the cursor to EOF. */
export function syncEditorContent(view: EditorView, content: string, reveal = false): boolean {
  const previous = view.state.doc.toString()
  if (previous === content)
    return false
  let from = 0
  while (from < previous.length && from < content.length && previous[from] === content[from])
    from++
  // Keep UTF-16 surrogate pairs intact when the changed character is an emoji.
  if (from > 0 && /[\uD800-\uDBFF]/.test(previous[from - 1]))
    from--
  let oldEnd = previous.length
  let newEnd = content.length
  while (oldEnd > from && newEnd > from && previous[oldEnd - 1] === content[newEnd - 1]) {
    oldEnd--
    newEnd--
  }
  if (oldEnd < previous.length && /[\uDC00-\uDFFF]/.test(previous[oldEnd])) {
    oldEnd++
    newEnd++
  }
  view.dispatch({
    changes: { from, to: oldEnd, insert: content.slice(from, newEnd) },
    annotations: Transaction.addToHistory.of(false),
    ...(reveal ? { selection: { anchor: from, head: newEnd }, scrollIntoView: true } : {}),
  })
  return true
}
