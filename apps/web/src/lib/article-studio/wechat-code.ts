/** WeChat drops inline <br> in pasted pre/code. Keep one block per source line. */
function codeRows(source: HTMLElement, diff: boolean): HTMLElement[] {
  if (diff) {
    return Array.from(source.children, (line) => {
      const row = document.createElement('section')
      row.style.cssText = line.getAttribute('style') ?? ''
      row.append(...line.childNodes)
      return row
    })
  }

  const rows: HTMLElement[] = []
  const range = document.createRange()
  for (const br of source.querySelectorAll('br')) {
    // A break can occur inside a multi-line highlighted token. Extracting a
    // range copies its enclosing spans, including the inline color, to both rows.
    range.setStart(source, 0)
    range.setEndBefore(br)
    const row = document.createElement('section')
    row.append(range.extractContents())
    rows.push(row)
    br.remove()
  }
  const last = document.createElement('section')
  last.append(...source.childNodes)
  rows.push(last)
  return rows
}

export function prepareWechatCodeBlock(pre: HTMLElement): void {
  const code = pre.querySelector<HTMLElement>(':scope > code')
  const source = code?.querySelector<HTMLElement>('.code-scroll > div, .code-block__inner')
  if (!code || !source)
    return

  const numbered = !!code.querySelector('.line-numbers')
  const rows = codeRows(source, code.className.startsWith('language-diff-'))
  const body = document.createElement('section')
  body.style.cssText = code.style.cssText
  Object.assign(body.style, {
    display: 'block', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
    overflowX: 'visible', textIndent: '0', textAlign: 'left',
    fontFamily: code.style.fontFamily || 'monospace',
  })
  body.setAttribute('role', 'code')
  for (const [i, row] of rows.entries()) {
    if (!row.textContent)
      row.append('\u00a0')
    if (numbered) {
      // Keep the number beside its own source line when long lines wrap.
      const text = document.createElement('span')
      text.style.minWidth = '0'
      text.append(...row.childNodes)
      const number = document.createElement('span')
      number.setAttribute('aria-hidden', 'true')
      number.style.cssText = `flex:none;min-width:${String(rows.length).length}ch;margin-right:1em;text-align:right;opacity:.65;user-select:none`
      number.textContent = String(i + 1)
      row.style.display = 'flex'
      row.append(number, text)
    }
    body.append(row)
  }
  const frame = document.createElement('section')
  frame.style.cssText = pre.style.cssText
  code.replaceWith(body)
  frame.append(...pre.childNodes)
  pre.replaceWith(frame)
}
