<script setup lang="ts">
import type SearchTabType from '@/components/ui/search-tab/SearchTab.vue'
import { Compartment, EditorState, Prec, Transaction } from '@codemirror/state'
import { EditorView, keymap, placeholder } from '@codemirror/view'
import { history, markdownSetup, resetEditorHistory, theme } from '@md/shared/editor'
import { toBase64 } from '@md/shared/utils/fileHelpers'
import { createComponentCompletionExtension } from '@/composables/useComponentCompletion'
import { useEditorRefresh } from '@/composables/useEditorRefresh'
import { useImageUploader } from '@/composables/useImageUploader'
import { completeInitialPreviewBoot } from '@/composables/useInitialPreviewBoot'
import { useLocalizedAllComponents } from '@/composables/useLocalizedBuiltinComponents'
import { useLocalizedUploadHostOptions } from '@/composables/useLocalizedUploadHosts'
import { useSlashCommand } from '@/composables/useSlashCommand'
import { CONTENT_FONT_LANG } from '@/i18n/constants'
import { toStoredDateTime } from '@/lib/format/datetime'
import { jumpToAdjacentHeading } from '@/lib/markdown/headingNavigation'
import { contentHasMath, loadMathJax, MATHJAX_READY_EVENT } from '@/lib/preview/mathjax'
import { collectClipboardImages } from '@/lib/upload/clipboard-images'
import { validateImageFile } from '@/lib/upload/validate-image'
import { materialLibraryEnabled } from '@/services/materials/client'
import { isUploadProviderConfigured } from '@/services/upload/provider-registry'
import { syncEditorContent } from '@/services/workspace/editor-content'
import { store } from '@/storage'
import { useEditorStore } from '@/stores/editor'
import { usePostStore } from '@/stores/post'
import { useRenderStore } from '@/stores/render'
import { useThemeStore } from '@/stores/theme'
import { useUIStore } from '@/stores/ui'
import { useWorkspaceStore } from '@/stores/workspace'

const SidebarAIToolbar = defineAsyncComponent(() => import('@/components/ai/SidebarAIToolbar.vue'))
const SlashCommandMenu = defineAsyncComponent(() => import('@/components/editor/SlashCommandMenu.vue'))
const SearchTab = defineAsyncComponent(() => import('@/components/ui/search-tab/SearchTab.vue'))

const { t, locale } = useI18n()
const uploadHostOptions = useLocalizedUploadHostOptions()
const editorStore = useEditorStore()
const postStore = usePostStore()
const renderStore = useRenderStore()
const themeStore = useThemeStore()
const uiStore = useUIStore()
const workspace = useWorkspaceStore()
const localizedAllComponents = useLocalizedAllComponents()
const { upload } = useImageUploader()
const { editorRefresh, scheduleEditorRefresh, flushScheduledRefresh } = useEditorRefresh()

const {
  visible: slashVisible,
  position: slashPosition,
  filter: slashFilter,
  activeIndex: slashActiveIndex,
  basicCommands: slashBasicCommands,
  commonCommands: slashCommonCommands,
  editCommands: slashEditCommands,
  styleCommands: slashStyleCommands,
  filteredCommands: slashFilteredCommands,
  closeMenu: closeSlashMenu,
  executeCommand: executeSlashCommand,
  createExtension: createSlashExtension,
} = useSlashCommand()

function onWrapperContextMenuCapture(e: MouseEvent) {
  if (!slashVisible.value)
    return
  e.preventDefault()
  e.stopPropagation()
}

const { editor } = storeToRefs(editorStore)
const { isDark, showAIToolbox } = storeToRefs(uiStore)
const { posts, currentPostIndex, currentPost } = storeToRefs(postStore)
const {
  isMobile,
  enableImageReupload,
  viewMode,
} = storeToRefs(uiStore)

const { toggleShowUploadImgDialog } = uiStore

const showEditor = computed(() => viewMode.value !== `preview`)

const codeMirrorView = shallowRef<EditorView | null>(null)
let displayedPostId: string | undefined
const themeCompartment = new Compartment()
const placeholderCompartment = new Compartment()
const historyCompartment = new Compartment()
const editableCompartment = new Compartment()

function editableExtensions() {
  const editable = Boolean(currentPost.value)
  return [EditorState.readOnly.of(!editable), EditorView.editable.of(editable)]
}

watch(() => currentPost.value?.id, () => {
  codeMirrorView.value?.dispatch({ effects: editableCompartment.reconfigure(editableExtensions()) })
})

function editorPlaceholder() {
  return placeholder(t(`codemirror.contentPlaceholder`))
}
const persistTimer = ref<ReturnType<typeof setTimeout>>()

const editorRef = useTemplateRef<HTMLDivElement>(`editorRef`)
const codeMirrorWrapper = useTemplateRef<HTMLDivElement>(`codeMirrorWrapper`)

const isImgLoading = ref(false)

// Editor refresh is provided by useEditorRefresh()

// --- Search tab integration ---
const searchTabRef = useTemplateRef<InstanceType<typeof SearchTabType>>(`searchTabRef`)
const searchTabMounted = ref(false)
const pendingSearchRequest = ref<{ selected: string } | null>(null)

function applySearchRequest(
  target: InstanceType<typeof SearchTabType>,
  word: string,
  showReplace = false,
) {
  if (showReplace)
    target.setSearchWithReplace(word)
  else if (word)
    target.setSearchWord(word)
  else
    target.showSearchTab = true
}

function mountSearchTab() {
  searchTabMounted.value = true
}

const { searchTabRequest } = storeToRefs(uiStore)

function openSearchWithSelection(view: EditorView) {
  mountSearchTab()
  const selection = view.state.selection.main
  const selected = view.state.doc.sliceString(selection.from, selection.to).trim()

  if (searchTabRef.value)
    applySearchRequest(searchTabRef.value, selected)
  else
    pendingSearchRequest.value = { selected }
}

function openReplaceWithSelection(view: EditorView) {
  mountSearchTab()
  const selection = view.state.selection.main
  const selected = view.state.doc.sliceString(selection.from, selection.to).trim()

  if (searchTabRef.value)
    searchTabRef.value.setSearchWithReplace(selected)
  else
    uiStore.openSearchTab(selected, true)
}

watch(searchTabRef, (newRef) => {
  if (!newRef)
    return

  if (pendingSearchRequest.value) {
    applySearchRequest(newRef, pendingSearchRequest.value.selected)
    pendingSearchRequest.value = null
  }

  if (searchTabRequest.value) {
    const { word, showReplace } = searchTabRequest.value
    applySearchRequest(newRef, word, showReplace)
    uiStore.clearSearchTabRequest()
  }
})

watch(searchTabRequest, (request) => {
  if (!request)
    return
  mountSearchTab()
  if (searchTabRef.value) {
    applySearchRequest(searchTabRef.value, request.word, request.showReplace)
    uiStore.clearSearchTabRequest()
  }
})

function handleGlobalKeydown(e: KeyboardEvent) {
  const editorView = codeMirrorView.value
  if (e.key === `Escape` && searchTabRef.value?.showSearchTab) {
    searchTabRef.value.showSearchTab = false
    e.preventDefault()
    editorView?.focus()
  }
}

// --- Image upload ---
async function beforeImageUpload(file: File) {
  const checkResult = validateImageFile(file, t)
  if (!checkResult.ok) {
    toast.error(checkResult.msg)
    return false
  }

  if (materialLibraryEnabled)
    return true

  const imgHost = (await store.get(`imgHost`)) || `default`
  await store.set(`imgHost`, imgHost)

  if (!await isUploadProviderConfigured(imgHost)) {
    const hostLabel = uploadHostOptions.value.find(option => option.value === imgHost)?.label ?? imgHost
    toast.error(t('editorPanel.configureImgHost', { host: hostLabel }))
    toggleShowUploadImgDialog(true)
    return false
  }

  return true
}

function uploaded(imageUrl: string, targetPostId = postStore.currentPostId, position?: number) {
  if (!imageUrl) {
    toast.error(t('editorPanel.uploadUnknownError'))
    return
  }
  setTimeout(() => {
    toggleShowUploadImgDialog(false)
  }, 1000)
  const markdownImage = `![](${imageUrl})`
  if (targetPostId !== postStore.currentPostId) {
    const target = postStore.getPostById(targetPostId)
    if (target) {
      const at = Math.min(position ?? target.content.length, target.content.length)
      postStore.updatePostContent(targetPostId, `${target.content.slice(0, at)}\n${markdownImage}\n${target.content.slice(at)}`)
    }
    return
  }
  if (codeMirrorView.value) {
    codeMirrorView.value.dispatch(codeMirrorView.value.state.replaceSelection(`\n${markdownImage}\n`))
  }
  toast.success(t('editorPanel.uploadSuccess'))
}

async function compressImage(file: File) {
  const { default: imageCompression } = await import(`browser-image-compression`)
  const options = {
    maxSizeMB: 1,
    maxWidthOrHeight: 1920,
    useWebWorker: true,
  }
  return await imageCompression(file, options)
}

async function uploadImage(
  file: File,
  cb?: (url: string, data: string) => void,
  applyUrl?: boolean,
) {
  const targetPostId = postStore.currentPostId
  const position = codeMirrorView.value?.state.selection.main.head
  try {
    isImgLoading.value = true
    const useCompression = (await store.get(`useCompression`)) === `true`
    if (useCompression && !materialLibraryEnabled)
      file = await compressImage(file)

    const url = await upload(file)
    if (cb) {
      cb(url, await toBase64(file))
    }
    else {
      uploaded(url, targetPostId, position)
    }
    if (applyUrl)
      return uploaded(url, targetPostId, position)
  }
  catch (err) {
    toast.error(err instanceof Error ? err.message : t('store.uploader.uploadFailed'))
    cb?.('', '')
  }
  finally {
    isImgLoading.value = false
  }
}

// --- Drag & drop folder ---
async function getMd({ list }: { list: { path: string, file: File }[] }) {
  return new Promise<{ str: string, file: File, path: string }>((resolve) => {
    const { path, file } = list.find(item => item.path.match(/\.md$/))!
    const reader = new FileReader()
    reader.readAsText(file!, `UTF-8`)
    reader.onload = (evt) => {
      resolve({
        str: evt.target!.result as string,
        file,
        path,
      })
    }
  })
}

async function showFileStructure(root: any) {
  const result = []
  let cwd = ``
  try {
    const dirs = [root]
    for (const dir of dirs) {
      cwd += `${dir.name}/`
      for await (const [, handle] of dir) {
        if (handle.kind === `file`) {
          result.push({
            path: cwd + handle.name,
            file: await handle.getFile(),
          })
        }
        else {
          result.push({
            path: `${cwd + handle.name}/`,
          })
          dirs.push(handle)
        }
      }
    }
  }
  catch (err) {
    console.error(err)
  }
  return result
}

async function uploadMdImg({
  md,
  list,
}: {
  md: { str: string, path: string, file: File }
  list: { path: string, file: File }[]
}) {
  const mdImgList = [...(md.str.matchAll(/!\[(.*?)\]\((.*?)\)/g) || [])].filter(item => item)
  const root = md.path.match(/.+?\//)![0]
  const resList = await Promise.all<{ matchStr: string, url: string }>(
    mdImgList.map((item) => {
      return new Promise((resolve) => {
        let [, , matchStr] = item
        matchStr = matchStr.replace(/^.\//, ``)
        const { file }
          = list.find(f => f.path === `${root}${matchStr}`) || {}
        uploadImage(file!, url => resolve({ matchStr, url }))
      })
    }),
  )
  resList.forEach((item) => {
    md.str = md.str
      .replace(`](./${item.matchStr})`, `](${item.url})`)
      .replace(`](${item.matchStr})`, `](${item.url})`)
  })
  if (codeMirrorView.value) {
    codeMirrorView.value.dispatch({
      changes: { from: 0, to: codeMirrorView.value.state.doc.length, insert: md.str },
    })
  }
}

function mdLocalToRemote() {
  // The async onMounted callback can resolve after an HMR remount, where the
  // template ref of the stale instance is already null.
  const dom = codeMirrorWrapper.value
  if (!dom)
    return

  dom.ondragover = evt => evt.preventDefault()
  dom.ondrop = async (evt) => {
    evt.preventDefault()
    if (evt.dataTransfer == null) {
      return
    }

    const images = Array.from(evt.dataTransfer.files).filter(file => file.type.startsWith('image/'))
    if (images.length) {
      for (const file of images) {
        if (await beforeImageUpload(file))
          await uploadImage(file)
      }
      return
    }

    for (const item of Array.from(evt.dataTransfer.items).filter(item => item.kind === `file`)) {
      const handle = await (item as DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> }).getAsFileSystemHandle?.()
      if (handle?.kind === `directory`) {
        const list = (await showFileStructure(handle)) as { path: string, file: File }[]
        const md = await getMd({ list })
        await uploadMdImg({ md, list })
      }
      else if (handle?.kind === `file`) {
        const file = await (handle as FileSystemFileHandle).getFile()
        if (await beforeImageUpload(file))
          await uploadImage(file)
      }
    }
  }
}

// --- Image paste handler for CodeMirror ---
function createPasteHandler() {
  return (event: ClipboardEvent, view: EditorView) => {
    const imageFiles = collectClipboardImages(event.clipboardData)
    if (imageFiles.length > 0) {
      if (isImgLoading.value)
        return true

      void (async () => {
        const validItems: File[] = []
        for (const item of imageFiles) {
          if (await beforeImageUpload(item))
            validItems.push(item)
        }
        for (const item of validItems)
          await uploadImage(item)
      })()
      return true
    }

    const text = event.clipboardData?.getData('text/plain')
    if (text) {
      const mdImgRegex = /!\[(.*?)\]\((https?:\/\/[^)]+)\)/g
      const matches = [...text.matchAll(mdImgRegex)]

      if (matches.length > 0) {
        isImgLoading.value = true

        let previewText = text
        const placeholderMap = new Map<string, { originalUrl: string, originalAlt: string }>()

        let matchIndex = 0
        previewText = previewText.replace(mdImgRegex, (_, alt, url) => {
          const id = `LOADING_${Date.now()}_${matchIndex++}`
          placeholderMap.set(id, { originalUrl: url, originalAlt: alt })
          return `![${t('editorPanel.reuploading')}](${id})`
        })

        view.dispatch(view.state.replaceSelection(previewText))

        const uniqueUrls = [...new Set(matches.map(m => m[2]))]

        Promise.all(uniqueUrls.map(async (url) => {
          try {
            const newUrl = materialLibraryEnabled || enableImageReupload.value ? await upload(url) : url

            for (const [id, info] of placeholderMap.entries()) {
              if (info.originalUrl === url) {
                const searchStr = `![${t('editorPanel.reuploading')}](${id})`
                const currentDoc = view.state.doc.toString()
                const pos = currentDoc.indexOf(searchStr)

                if (pos !== -1) {
                  const newText = `![${info.originalAlt}](${newUrl})`
                  view.dispatch({
                    changes: { from: pos, to: pos + searchStr.length, insert: newText },
                  })
                }
              }
            }
          }
          catch (e) {
            console.error(`转存失败: ${url}`, e)
            for (const [id, info] of placeholderMap.entries()) {
              if (info.originalUrl === url) {
                const searchStr = `![${t('editorPanel.reuploading')}](${id})`
                const currentDoc = view.state.doc.toString()
                const pos = currentDoc.indexOf(searchStr)

                if (pos !== -1) {
                  const newText = `![${info.originalAlt}](${info.originalUrl})`
                  view.dispatch({
                    changes: { from: pos, to: pos + searchStr.length, insert: newText },
                  })
                }
              }
            }
            toast.error(t('editorPanel.reuploadFailed'))
          }
        })).finally(() => {
          isImgLoading.value = false
        })

        return true
      }
    }
    return false
  }
}

// --- CodeMirror creation ---
function createFormTextArea(dom: HTMLDivElement) {
  displayedPostId = currentPost.value?.id
  const state = EditorState.create({
    doc: posts.value[currentPostIndex.value]?.content ?? '',
    extensions: [
      markdownSetup({
        onSearch: openSearchWithSelection,
        onReplace: openReplaceWithSelection,
        onGoToLine: () => uiStore.requestGoToLine(),
        withoutHistory: true,
      }),
      historyCompartment.of(history()),
      editableCompartment.of(editableExtensions()),
      Prec.high(keymap.of([
        { key: `Mod-Alt-ArrowUp`, run: view => jumpToAdjacentHeading(view, `prev`) },
        { key: `Mod-Alt-ArrowDown`, run: view => jumpToAdjacentHeading(view, `next`) },
      ])),
      placeholderCompartment.of(editorPlaceholder()),
      themeCompartment.of(theme(isDark.value)),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          scheduleEditorRefresh()
          if (update.transactions.every(transaction => transaction.annotation(Transaction.addToHistory) === false))
            return
          if (workspace.enabled) {
            commitEditorContentToPost()
            return
          }
          clearTimeout(persistTimer.value)
          persistTimer.value = setTimeout(() => {
            commitEditorContentToPost()
          }, 300)
        }
      }),
      EditorView.domEventHandlers({
        paste: createPasteHandler(),
      }),
      ...createSlashExtension(() => codeMirrorView.value),
      ...createComponentCompletionExtension(() => localizedAllComponents.value),
    ],
  })

  const view = new EditorView({
    state,
    parent: dom,
  })

  codeMirrorView.value = view
  return view
}

// --- Lifecycle ---
function handleMathJaxReady() {
  editorRefresh()
}

async function preloadMathJaxIfNeeded(content: string) {
  if (!contentHasMath(content))
    return

  try {
    await loadMathJax()
  }
  catch (error) {
    console.error(error)
  }
}

let postSwitchGeneration = 0

function flushEditorContentToPost(postId = displayedPostId) {
  clearTimeout(persistTimer.value)
  persistTimer.value = undefined
  if (!codeMirrorView.value || !postId || workspace.applyingRemote)
    return

  const value = codeMirrorView.value.state.doc.toString()
  const post = postStore.getPostById(postId)
  if (!post || value === post.content)
    return

  post.updateDatetime = new Date()
  post.content = value
}

function commitEditorContentToPost() {
  flushEditorContentToPost()
}

onMounted(() => {
  const editorDom = editorRef.value
  if (editorDom == null) {
    void completeInitialPreviewBoot()
    return
  }

  window.addEventListener(MATHJAX_READY_EVENT, handleMathJaxReady)
  document.addEventListener(`keydown`, handleGlobalKeydown, { passive: false, capture: false })

  void (async () => {
    try {
      await renderStore.initRendererInstance({
        isMacCodeBlock: themeStore.isMacCodeBlock,
        isShowLineNumber: themeStore.isShowLineNumber,
      })
      themeStore.applyCurrentTheme()
      await nextTick()

      const editorView = createFormTextArea(editorDom)
      editor.value = editorView
      editorStore.registerContentFlush(commitEditorContentToPost)

      const content = posts.value[currentPostIndex.value]?.content ?? ``
      await preloadMathJaxIfNeeded(content)

      editorRefresh()
      mdLocalToRemote()
    }
    catch (error) {
      console.error(`[EditorPanel] Failed to initialize editor`, error)
    }
    finally {
      void completeInitialPreviewBoot()
    }
  })()
})

watch(isDark, () => {
  if (codeMirrorView.value) {
    codeMirrorView.value.dispatch({
      effects: themeCompartment.reconfigure(theme(isDark.value)),
    })
  }
  editorRefresh()
})

watch(locale, () => {
  if (!codeMirrorView.value)
    return
  codeMirrorView.value.dispatch({
    effects: placeholderCompartment.reconfigure(editorPlaceholder()),
  })
  editorRefresh()
})

function syncEditorToPostContent(content: string, reveal: boolean, switched: boolean) {
  const view = codeMirrorView.value
  if (!view)
    return

  const changed = syncEditorContent(view, content, reveal)
  if (switched || changed)
    resetEditorHistory(view, historyCompartment)
  if (!changed)
    return

  const generation = ++postSwitchGeneration
  void preloadMathJaxIfNeeded(content).then(() => {
    if (generation !== postSwitchGeneration)
      return
    flushScheduledRefresh()
  })
}

/** Track document identity, not its position in a reordered shared library. */
watch(
  [() => currentPost.value?.id, () => currentPost.value?.content, () => workspace.historyReveal?.revision],
  ([id, content, revision], [, , previousRevision]) => {
    const switched = id !== displayedPostId
    if (switched && !workspace.enabled)
      flushEditorContentToPost()
    displayedPostId = id
    const reveal = revision !== previousRevision && workspace.historyReveal?.postId === id
    syncEditorToPostContent(content ?? '', reveal, switched)
  },
)

const historyTimer = ref<ReturnType<typeof setTimeout>>()
onMounted(() => {
  historyTimer.value = setInterval(() => {
    if (workspace.enabled)
      return
    const currentPost = posts.value[currentPostIndex.value]

    if (!currentPost)
      return

    const pre = (currentPost.history || [])[0]?.content
    if (pre === currentPost.content) {
      return
    }

    currentPost.history ??= []
    currentPost.history.unshift({
      content: currentPost.content,
      datetime: toStoredDateTime(),
    })

    currentPost.history.length = Math.min(currentPost.history.length, 10)
  }, 30 * 1000)
})

onUnmounted(() => {
  editorStore.unregisterContentFlush()
  window.removeEventListener(MATHJAX_READY_EVENT, handleMathJaxReady)
  clearTimeout(historyTimer.value)
  clearTimeout(persistTimer.value)
  document.removeEventListener(`keydown`, handleGlobalKeydown, { capture: false })
})

defineExpose({
  codeMirrorView,
  editorRefresh,
  uploadImage,
  isImgLoading,
})
</script>

<template>
  <div
    v-show="viewMode !== 'preview'"
    ref="codeMirrorWrapper"
    class="codeMirror-wrapper relative h-full"
    @contextmenu.capture="onWrapperContextMenuCapture"
  >
    <SearchTab
      v-if="searchTabMounted && codeMirrorView"
      ref="searchTabRef"
      :editor-view="codeMirrorView as any"
    />
    <SlashCommandMenu
      v-if="slashVisible"
      :visible="slashVisible"
      :position="slashPosition"
      :active-index="slashActiveIndex"
      :filter="slashFilter"
      :container-el="codeMirrorWrapper"
      :basic-commands="slashBasicCommands"
      :common-commands="slashCommonCommands"
      :edit-commands="slashEditCommands"
      :style-commands="slashStyleCommands"
      :filtered-commands="slashFilteredCommands"
      @execute="(cmd) => codeMirrorView && executeSlashCommand(codeMirrorView, cmd)"
      @close="closeSlashMenu()"
    />
    <SidebarAIToolbar
      v-if="showAIToolbox"
      :is-mobile="isMobile"
      :show-editor="showEditor"
    />

    <EditorContextMenu>
      <div
        id="editor"
        ref="editorRef"
        class="codemirror-container mathjax-ignore"
        :lang="CONTENT_FONT_LANG"
      />
    </EditorContextMenu>
  </div>
</template>

<style lang="less" scoped>
@import url('../../assets/less/app.less');
</style>

<style lang="less" scoped>
.codeMirror-wrapper {
  overflow-x: hidden;
  height: 100%;
  position: relative;
}
</style>
