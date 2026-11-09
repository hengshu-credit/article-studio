import type { EditorView } from '@codemirror/view'
import { NO_INDENT_MARKER } from '@article-studio/article-kit'
import { EditorState } from '@codemirror/state'
import { markdownSetup, redoAction, undoAction } from '@md/shared/editor'
import { describe, expect, it } from 'vitest'
import { formatBlock, insertBlock, insertCodeFence, paragraphIndentState, toggleParagraphIndent } from './editor-actions'

function editing(doc: string, from: number, to = from): EditorView {
  let state = EditorState.create({ doc, selection: { anchor: from, head: to }, extensions: markdownSetup() })
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

describe(`paragraph indentation`, () => {
  it(`toggles the whole multiline paragraph at the cursor, retaining inline Markdown and neighboring paragraphs`, () => {
    const source = `前一段\n\n这段 **加粗** 和 [链接](https://example.com)\n仍属于同一段。\n\n后一段`
    const view = editing(source, source.indexOf(`同一段`))
    expect(paragraphIndentState(view.state)).toEqual({ available: true, noIndent: false })
    toggleParagraphIndent(view)
    expect(view.state.doc.toString()).toBe(source.replace(`这段`, `${NO_INDENT_MARKER}这段`))
    expect(paragraphIndentState(view.state).noIndent).toBe(true)
    toggleParagraphIndent(view)
    expect(view.state.doc.toString()).toBe(source)
  })

  it(`applies to selected prose without altering headings, lists, quotes, code, images or tables`, () => {
    const source = `# 标题\n\n第一段\n\n\`\`\`python\nprint("保留")\n\`\`\`\n\n| 字段 | 值 |\n| --- | --- |\n| A | 1 |\n\n- 列表\n\n> 引用\n\n![图片](https://example.com/a.png)\n\n[![链接图片](https://example.com/b.png)](https://example.com)\n\n<MetricCardV1 label="样本" value="8 条" />\n\n第二段`
    const view = editing(source, 0, source.length)
    toggleParagraphIndent(view)
    const expected = source.replace(`第一段`, `${NO_INDENT_MARKER}第一段`).replace(`第二段`, `${NO_INDENT_MARKER}第二段`)
    expect(view.state.doc.toString()).toBe(expected)
    undoAction(view)
    expect(view.state.doc.toString()).toBe(source)
    redoAction(view)
    expect(view.state.doc.toString()).toBe(expected)
    toggleParagraphIndent(view)
    expect(view.state.doc.toString()).toBe(source)
  })

  it(`does not include the next paragraph when selection ends at its first character`, () => {
    const source = `第一段\n\n第二段`
    const view = editing(source, 0, source.indexOf(`第二段`))
    toggleParagraphIndent(view)
    expect(view.state.doc.toString()).toBe(`${NO_INDENT_MARKER}第一段\n\n第二段`)
  })

  it(`normalizes mixed selections without duplicate markers, then restores the default`, () => {
    const source = `${NO_INDENT_MARKER}第一段\n\n第二段`
    const view = editing(source, 0, source.length)
    expect(paragraphIndentState(view.state).noIndent).toBe(false)
    toggleParagraphIndent(view)
    expect(view.state.doc.toString()).toBe(`${NO_INDENT_MARKER}第一段\n\n${NO_INDENT_MARKER}第二段`)
    toggleParagraphIndent(view)
    expect(view.state.doc.toString()).toBe(`第一段\n\n第二段`)
  })

  it(`leaves YAML, empty lines, display math and code untouched`, () => {
    for (const [source, position] of [
      [`---\ntitle: 文章\n---\n\n正文`, 6],
      [`第一段\n\n第二段`, 4],
      [`$$\nx + y\n$$`, 4],
      [`\`\`\`python\nprint(1)\n\`\`\``, 12],
      [`\`\`\`markdown\n普通段落\n\`\`\``, 15],
    ] as const) {
      const view = editing(source, position)
      expect(paragraphIndentState(view.state).available).toBe(false)
      expect(toggleParagraphIndent(view)).toBe(false)
      expect(view.state.doc.toString()).toBe(source)
    }
  })
})
