import type { EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { formatBlock, insertBlock, insertCodeFence } from './editor-actions'

function editing(doc: string, from: number, to = from): EditorView {
  let state = EditorState.create({ doc, selection: { anchor: from, head: to } })
  return {
    get state() { return state },
    dispatch(spec: Parameters<EditorState[`update`]>[0]) { state = state.update(spec).state },
    focus() {},
  } as unknown as EditorView
}

describe(`writing toolbar document operations`, () => {
  it(`quotes whole selected lines, excludes an unselected following line and toggles back`, () => {
    const view = editing(`first\nsecond\nthird`, 2, 13)
    formatBlock(view, `quote`)
    expect(view.state.doc.toString()).toBe(`> first\n> second\nthird`)
    formatBlock(view, `quote`)
    expect(view.state.doc.toString()).toBe(`first\nsecond\nthird`)
  })
  it(`converts bullet lists to numbered lists without stacking prefixes`, () => {
    const view = editing(`- one\n- two`, 0, 11)
    formatBlock(view, `ordered`)
    expect(view.state.doc.toString()).toBe(`1. one\n2. two`)
  })
  it(`isolates inserted components from adjacent paragraphs while preserving surrounding text`, () => {
    const view = editing(`beforeafter`, 6)
    insertBlock(view, `<MetricCardV1 label="count" value="8" />`)
    expect(view.state.doc.toString()).toBe(`before\n\n<MetricCardV1 label="count" value="8" />\n\nafter`)
  })
  it(`keeps literal fences inside selected code from closing the newly inserted block`, () => {
    const body = `print("hello")\n\`\`\`\nend`
    const view = editing(body, 0, body.length)
    insertCodeFence(view, `python`)
    expect(view.state.doc.toString()).toBe(`\`\`\`\`python\n${body}\n\`\`\`\``)
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe(body)
  })
})
