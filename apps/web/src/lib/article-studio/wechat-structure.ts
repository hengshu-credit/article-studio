function retag(element: Element, tag: string): HTMLElement {
  const replacement = document.createElement(tag)
  for (const { name, value } of element.attributes)
    replacement.setAttribute(name, value)
  replacement.append(...element.childNodes)
  element.replaceWith(replacement)
  return replacement
}

const roles = { h3: 'heading', h4: 'heading', ol: 'list', ul: 'list', li: 'listitem' } as const

/** Run after CSS inlining: keep WeChat from rebuilding native headings and list markers. */
export function prepareWeChatStructure(root: HTMLElement, referenceTheme = false): void {
  const ordered = 'ol.article-ordered-list, ol.article-ordered-list > li'
  const selector = referenceTheme ? `${ordered}, h3.wechat-subsection, h4.wechat-minor-heading, ul:has(> li .wechat-list-square), ul > li:has(.wechat-list-square)` : ordered
  for (const el of root.querySelectorAll(selector)) {
    const tag = el.localName as keyof typeof roles
    const section = retag(el, 'section')
    section.dataset.wechatTag = tag
    section.setAttribute('role', roles[tag])
    if (roles[tag] === 'heading')
      section.setAttribute('aria-level', tag.slice(1))
  }
  // WeChat can merge nested inline spans when it wraps heading text in leaves.
  if (referenceTheme) {
    for (const el of root.querySelectorAll('.wechat-subsection-row, .wechat-subsection-row > span'))
      retag(el, 'section')
  }
}

/** Text and Markdown projections need native semantics for headings and nested lists. */
export function restoreReferenceStructure(root: DocumentFragment): void {
  for (const el of root.querySelectorAll<HTMLElement>('section[data-wechat-tag]')) {
    const tag = el.dataset.wechatTag!
    if (Object.keys(roles).includes(tag))
      retag(el, tag)
  }
  for (const el of root.querySelectorAll('h3.wechat-subsection > section.wechat-subsection-row, h3.wechat-subsection > .wechat-subsection-row > section'))
    retag(el, 'span')
}
