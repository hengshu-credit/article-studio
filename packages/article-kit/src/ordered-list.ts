/** Keep decimal markers in the text flow so WeChat can retain their color and spacing. */
export function styleOrderedLists(root: HTMLElement, color: string): void {
  const flushLeft = { paddingLeft: '0', paddingRight: '0', marginLeft: '0', marginRight: '0', textIndent: '0', textAlign: 'left' }
  for (const list of root.querySelectorAll('ol')) {
    if (list.type && list.type !== '1')
      continue
    const items = list.querySelectorAll<HTMLLIElement>(':scope > li')
    let ordinal = list.reversed && !list.hasAttribute('start') ? items.length : list.start
    list.classList.add('article-ordered-list')
    Object.assign(list.style, flushLeft, { listStyle: 'none' })
    for (const item of items) {
      if (item.hasAttribute('value'))
        ordinal = item.value
      const prefix = `${ordinal}. `
      ordinal += list.reversed ? -1 : 1
      Object.assign(item.style, flushLeft, { display: 'block', letterSpacing: 'inherit' })
      for (const paragraph of item.querySelectorAll<HTMLElement>(':scope > p'))
        Object.assign(paragraph.style, flushLeft)

      // Core renders the ordinal as text. Leave numbers in imported HTML untouched.
      const first = item.firstChild
      if (item.classList.contains('listitem') && first instanceof Text && first.data.startsWith(prefix))
        first.deleteData(0, prefix.length)
      const lead = [...item.childNodes].find(node => node instanceof Element || node.textContent?.trim())
      const line = lead instanceof HTMLParagraphElement ? lead : item
      const marker = line.querySelector<HTMLSpanElement>(':scope > .article-list-number') ?? document.createElement('span')
      marker.className = 'article-list-number'
      marker.style.color = color
      marker.style.letterSpacing = 'normal'
      marker.textContent = prefix
      line.prepend(marker)
    }
  }
}
