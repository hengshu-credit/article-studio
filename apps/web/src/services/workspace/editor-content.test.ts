import type { EditorView } from '@codemirror/view'
import { EditorState, Transaction } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { syncEditorContent } from './editor-content'

function editor(doc: string, anchor: number) {
  let state = EditorState.create({ doc, selection: { anchor } })
  const transactions: Transaction[] = []
  const view = {
    get state() { return state },
    dispatch(spec: Parameters<EditorState['update']>[0]) {
      const transaction = state.update(spec)
      transactions.push(transaction)
      state = transaction.state
    },
  } as unknown as EditorView
  return { view, transactions }
}

describe('editor content synchronization', () => {
  it('preserves the cursor near a remote change instead of replacing the entire document', () => {
    const { view, transactions } = editor('开头\n原文\n结尾', 1)
    syncEditorContent(view, '开头\n新的正文\n结尾')
    expect(view.state.doc.toString()).toBe('开头\n新的正文\n结尾')
    expect(view.state.selection.main.head).toBe(1)
    expect(transactions[0].annotation(Transaction.addToHistory)).toBe(false)
    expect(transactions[0].scrollIntoView).toBe(false)
  })

  it('reveals the changed text on undo and redo without recording another local edit', () => {
    const { view, transactions } = editor('开头\n新的正文\n结尾', 0)
    syncEditorContent(view, '开头\n原文\n结尾', true)
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('原')
    expect(transactions[0].scrollIntoView).toBe(true)
    syncEditorContent(view, '开头\n新的正文\n结尾', true)
    expect(view.state.doc.toString()).toBe('开头\n新的正文\n结尾')
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('新的正')
    expect(transactions.every(t => t.annotation(Transaction.addToHistory) === false)).toBe(true)
    expect(syncEditorContent(view, view.state.doc.toString(), true)).toBe(false)
    expect(transactions).toHaveLength(2)
  })

  it('keeps emoji characters whole and reveals the deletion position', () => {
    const { view } = editor('A😀B', 0)
    syncEditorContent(view, 'A😁B', true)
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('😁')
    syncEditorContent(view, 'AB', true)
    expect(view.state.doc.toString()).toBe('AB')
    expect(view.state.selection.main.head).toBe(1)
  })
})
