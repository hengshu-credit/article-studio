// @vitest-environment jsdom
import { initRenderer } from '@md/core/renderer'
import { renderMarkdown } from '@md/core/utils'
import juice from 'juice'
import { expect, it } from 'vitest'
import { prepareWechatHtml } from './artifact-html'

it.each([false, true])('preserves source lines and token colors after WeChat drops breaks (numbers: %s)', (numbered) => {
  const lines = ['def report():', '    """first', '    second"""', '', '    return "<br>"']
  const renderer = initRenderer({ isShowLineNumber: numbered })
  const { html } = renderMarkdown(['```python', ...lines, '```'].join('\n'), renderer)
  const prepared = prepareWechatHtml(juice(`<style>.hljs-string{color:#50a14f}</style>${html}`))
  expect(prepareWechatHtml(prepared)).toBe(prepared)
  const doc = new DOMParser().parseFromString(prepared, 'text/html')
  doc.querySelectorAll('br, style').forEach(el => el.remove())
  const rows = [...doc.querySelectorAll('[role="code"] > section')]
  if (numbered) {
    const numbers = rows.map(row => row.querySelector('[aria-hidden="true"]')!)
    expect(numbers.map(el => el.textContent)).toEqual(['1', '2', '3', '4', '5'])
    numbers.forEach(el => el.remove())
  }
  expect(rows.map(row => row.textContent.replace(/\u00a0/g, ' ').trimEnd())).toEqual(lines)
  for (const row of rows.slice(1, 3))
    expect(row.querySelector<HTMLElement>('.hljs-string')?.style.color).toBe('rgb(80, 161, 79)')
})

it('retains diff markers and their per-line backgrounds', () => {
  const { html } = renderMarkdown('```diff-js\n-old()\n+newer()\n```', initRenderer({}))
  const doc = new DOMParser().parseFromString(prepareWechatHtml(html), 'text/html')
  const rows = [...doc.querySelectorAll<HTMLElement>('[role="code"] > section')]
  expect(rows.map(row => row.textContent)).toEqual(['-old()', '+newer()'])
  expect(rows.every(row => row.style.backgroundColor)).toBe(true)
  expect(rows[0].style.backgroundColor).not.toBe(rows[1].style.backgroundColor)
})
