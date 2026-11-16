import type { Text } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { MaybeRefOrGetter, Ref } from 'vue'
import { mapScroll } from '@/lib/preview/scroll-sync-blocks'
import { useRenderStore } from '@/stores/render'

type Pane = 'editor' | 'preview'

export function useScrollSync(
  codeMirrorViewRef: MaybeRefOrGetter<EditorView | null>,
  previewContainerRef: MaybeRefOrGetter<HTMLElement | null>,
  enableScrollSync: Ref<boolean>,
) {
  const render = useRenderStore()

  watchEffect((onCleanup) => {
    const view = toValue(codeMirrorViewRef)
    const preview = toValue(previewContainerRef)
    const output = preview?.querySelector('#output')
    if (!enableScrollSync.value || !view || !preview || !output)
      return

    const panes = { editor: view.scrollDOM, preview }
    let positions: { line: number, top: number }[] | undefined
    let checkedDoc: Text | undefined
    let matches = false
    let frame = 0
    let driver: Pane | undefined
    const pending: Record<Pane, number | undefined> = { editor: undefined, preview: undefined }

    const sync = (from: Pane) => {
      const doc = view.state.doc
      const source = render.scrollMap
      if (!source)
        return
      if (checkedDoc !== doc) {
        matches = doc.toString() === source.markdown
        checkedDoc = doc
      }
      // The preview is debounced; its old line numbers belong to another revision.
      if (!matches || !panes.editor.clientWidth || !preview.clientWidth)
        return
      const end = {
        editor: panes.editor.scrollHeight - panes.editor.clientHeight,
        preview: preview.scrollHeight - preview.clientHeight,
      }
      if (end[from] <= 0)
        return

      if (!positions) {
        positions = []
        const container = output.firstElementChild
        const origin = preview.getBoundingClientRect().top + preview.clientTop - preview.scrollTop
        for (const { child, line } of source.blocks) {
          const element = container?.children[child]
          if (!element || !Number.isInteger(line) || line < 1 || line > doc.lines || !element.getClientRects().length)
            continue
          const top = element.getBoundingClientRect().top - origin
          const last = positions[positions.length - 1]
          if (top > (last?.top ?? 0) && line > (last?.line ?? 0))
            positions.push({ line, top })
        }
      }

      // CodeMirror refines wrapped line heights as its viewport moves. Read
      // only the lines visited by the binary search from the current layout.
      const editorOrigin = view.documentTop - panes.editor.getBoundingClientRect().top - panes.editor.clientTop + panes.editor.scrollTop
      const to = from === 'editor' ? 'preview' : 'editor'
      const target = panes[to]
      const measured = positions
      const top = mapScroll(panes[from].scrollTop, from, end, measured.length, (i) => {
        const anchor = measured[i]
        return { editor: editorOrigin + view.lineBlockAt(doc.line(anchor.line).from).top, preview: anchor.top }
      })
      if (Math.abs(target.scrollTop - top) > 0.5) {
        target.scrollTop = top
        // Ignore the browser's rounded/clamped echo, but let an actual wheel
        // or drag in the opposite pane take over immediately.
        pending[to] = target.scrollTop
      }
    }

    function schedule() {
      if (!frame && driver) {
        frame = requestAnimationFrame(() => {
          frame = 0
          if (driver)
            sync(driver)
        })
      }
    }

    function onScroll(from: Pane) {
      const expected = pending[from]
      pending[from] = undefined
      if (expected !== undefined && Math.abs(panes[from].scrollTop - expected) < 1)
        return
      driver = from
      schedule()
    }
    const editorScroll = () => onScroll('editor')
    const previewScroll = () => onScroll('preview')

    function invalidate() {
      positions = undefined
      schedule()
    }
    const stopMapWatch = watch(() => render.scrollMap, () => {
      checkedDoc = undefined
      invalidate()
    }, { flush: 'post' })
    const resize = new ResizeObserver(invalidate)
    resize.observe(output)
    resize.observe(preview)
    resize.observe(panes.editor)
    const mutations = new MutationObserver(invalidate)
    mutations.observe(output, { childList: true, subtree: true, attributes: true })
    preview.addEventListener('load', invalidate, true)
    preview.addEventListener('scroll', previewScroll, { passive: true })
    panes.editor.addEventListener('scroll', editorScroll, { passive: true })

    onCleanup(() => {
      cancelAnimationFrame(frame)
      stopMapWatch()
      resize.disconnect()
      mutations.disconnect()
      preview.removeEventListener('load', invalidate, true)
      preview.removeEventListener('scroll', previewScroll)
      panes.editor.removeEventListener('scroll', editorScroll)
    })
  }, { flush: 'post' })
}
