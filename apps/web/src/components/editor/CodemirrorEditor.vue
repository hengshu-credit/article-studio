<script setup lang="ts">
import { defineAsyncComponent, unref } from 'vue'
import EditorPanel from '@/components/editor/EditorPanel.vue'
import PreviewPanel from '@/components/editor/PreviewPanel.vue'
import WritingToolbar from '@/components/editor/WritingToolbar.vue'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'
import { useCursorSync } from '@/composables/useCursorSync'
import { useScrollSync } from '@/composables/useScrollSync'
import { materialLibraryEnabled } from '@/services/materials/client'
import { useUIStore } from '@/stores/ui'

const PostSlider = defineAsyncComponent(() => import('@/components/editor/post-slider/index.vue'))
const FolderSourcePanel = defineAsyncComponent(() => import('@/components/editor/folder-source-panel/index.vue'))
const CssEditor = defineAsyncComponent(() => import('@/components/editor/CssEditor.vue'))
const RightSlider = defineAsyncComponent(() => import('@/components/editor/RightSlider.vue'))
const loadEmojiManagerPanel = () => import('@/components/editor/emoji/EmojiManagerPanel.vue')
const EmojiManagerPanel = defineAsyncComponent(loadEmojiManagerPanel)
const UploadImgDialog = defineAsyncComponent(() => import('@/components/editor/dialogs/UploadImgDialog.vue'))
const MaterialLibraryDialog = defineAsyncComponent(() => import('@/components/editor/dialogs/MaterialLibraryDialog.vue'))
const TableEditDialog = defineAsyncComponent(() => import('@/components/editor/dialogs/TableEditDialog.vue'))
const ImportMarkdownDialog = defineAsyncComponent(() => import('@/components/editor/dialogs/ImportMarkdownDialog.vue'))
const LocalImageUploadDialog = defineAsyncComponent(() => import('@/components/editor/dialogs/LocalImageUploadDialog.vue'))
const FormulaEditorDialog = defineAsyncComponent(() => import('@/components/editor/dialogs/FormulaEditorDialog.vue'))
const TemplateDialog = defineAsyncComponent(() => import('@/components/editor/dialogs/TemplateDialog.vue'))
const CustomComponentDialog = defineAsyncComponent(() => import('@/components/editor/dialogs/CustomComponentDialog.vue'))
const MarketplaceDialog = defineAsyncComponent(() => import('@/components/editor/dialogs/MarketplaceDialog.vue'))

const uiStore = useUIStore()
const { width: workspaceViewportWidth } = useWindowSize()
const sidebarTargetSize = computed(() => Math.min(24, 240 / workspaceViewportWidth.value * 100))
const sidebarMinSize = computed(() => Math.min(24, 220 / workspaceViewportWidth.value * 100))
const sidebarMaxSize = computed(() => Math.min(32, 360 / workspaceViewportWidth.value * 100))
const settingsTargetSize = computed(() => Math.min(38, Math.max(16, 340 / Math.max(600, workspaceViewportWidth.value - (uiStore.isOpenPostSlider ? 240 : 0)) * 100)))

const {
  isMobile,
  isOpenPostSlider,
  isOpenFolderPanel,
  isOpenRightSlider,
  viewMode,
  enableScrollSync,
  isShowUploadImgDialog,
  isShowTableEditDialog,
  isShowImportMdDialog,
  isShowLocalImageUpload,
  isShowFormulaEditorDialog,
  isShowTemplateDialog,
  isShowComponentDialog,
  isShowMarketplaceDialog,
} = storeToRefs(uiStore)

const editorPanelCompRef = ref<InstanceType<typeof EditorPanel> | null>(null)
const previewPanelCompRef = ref<InstanceType<typeof PreviewPanel> | null>(null)

const getEditorView = () => editorPanelCompRef.value?.codeMirrorView ?? null
const getPreviewContainer = () => previewPanelCompRef.value?.previewRef ?? null

const { handlePreviewContentClick } = useCursorSync(getEditorView)

useScrollSync(getEditorView, getPreviewContainer, enableScrollSync)

const backLight = ref(false)
const isCoping = ref(false)
let copyEndTimer: ReturnType<typeof setTimeout> | null = null

function startCopy() {
  backLight.value = true
  isCoping.value = true
}

function endCopy() {
  backLight.value = false
  if (copyEndTimer) {
    clearTimeout(copyEndTimer)
  }
  copyEndTimer = setTimeout(() => {
    isCoping.value = false
    copyEndTimer = null
  }, 800)
}

onUnmounted(() => {
  if (copyEndTimer) {
    clearTimeout(copyEndTimer)
    copyEndTimer = null
  }
})

function handleUploadImage(file: File, cb?: any, applyUrl?: boolean) {
  editorPanelCompRef.value?.uploadImage(file, cb, applyUrl)
}

const EMOJI_PANEL_TARGET_SIZE = 30
const EMOJI_PANEL_MIN_SIZE = 22
const EMOJI_PANEL_MAX_SIZE = 50

const cssPanelTargetSize = computed(() =>
  !isMobile.value && uiStore.isShowCssEditor ? settingsTargetSize.value : 0)
const rightPanelTargetSize = computed(() =>
  !isMobile.value && isOpenRightSlider.value ? settingsTargetSize.value : 0)
const emojiPanelTargetSize = computed(() =>
  !isMobile.value && uiStore.isOpenEmojiManager ? EMOJI_PANEL_TARGET_SIZE : 0)
const contentPanelTargetSize = computed(() =>
  100 - cssPanelTargetSize.value - rightPanelTargetSize.value - emojiPanelTargetSize.value)

// Side panels must keep a zero default so Reka can safely re-derive layouts;
// their non-zero target sizes are applied imperatively after state changes.
const hasSidePanel = computed(() =>
  cssPanelTargetSize.value + rightPanelTargetSize.value + emojiPanelTargetSize.value > 0)

const editorPanelConfig = computed(() => {
  const mode = viewMode.value
  if (mode === `preview`) {
    return { min: 0, max: 0 }
  }
  if (mode === `edit`) {
    return hasSidePanel.value ? { min: 30, max: 85 } : { min: 100, max: 100 }
  }
  if (isMobile.value)
    return { min: 30, max: 70 }
  return { min: 15, max: 85 }
})

const previewPanelConfig = computed(() => {
  const mode = viewMode.value
  if (mode === `edit`) {
    return { min: 0, max: 0 }
  }
  if (mode === `preview`) {
    return hasSidePanel.value ? { min: 20, max: 75 } : { min: 100, max: 100 }
  }
  if (isMobile.value)
    return { min: 30, max: 70 }
  return { min: 15, max: 85 }
})

const editorResizablePanelRef = ref<InstanceType<typeof ResizablePanel> | null>(null)
const previewResizablePanelRef = ref<InstanceType<typeof ResizablePanel> | null>(null)
const postSliderPanelRef = ref<InstanceType<typeof ResizablePanel> | null>(null)
const editorShellRef = useTemplateRef<HTMLDivElement>('editorShell')
const observedSidebarWidth = ref(240)
const sidebarElement = computed(() => postSliderPanelRef.value?.$el as HTMLElement | undefined)
useResizeObserver(sidebarElement, ([entry]) => {
  if (!entry)
    return
  const bounds = entry.target.getBoundingClientRect()
  if (bounds.width > 0)
    observedSidebarWidth.value = bounds.right - (editorShellRef.value?.getBoundingClientRect().left ?? 0)
}, { box: 'border-box' })
const headerBrandWidth = computed(() => !isMobile.value && isOpenPostSlider.value ? observedSidebarWidth.value : 180)
const cssEditorPanelRef = ref<InstanceType<typeof ResizablePanel> | null>(null)
const rightSliderPanelRef = ref<InstanceType<typeof ResizablePanel> | null>(null)
const emojiManagerPanelRef = ref<InstanceType<typeof ResizablePanel> | null>(null)
const hasMountedEmojiManager = ref(uiStore.isOpenEmojiManager)

type ResizablePanelRef = Ref<InstanceType<typeof ResizablePanel> | null>

/**
 * reka-ui's imperative resize() throws when the group layout does not include
 * the panel yet (mount / HMR remount / constraint-change race). Defer past the
 * whole Vue flush with rAF — nextTick still runs inside the flush, where
 * setLayout re-queues SplitterGroup's own update and Vue aborts with
 * "Maximum recursive updates exceeded". Skip no-op resizes so imperative
 * calls cannot start a constraint cascade; a skipped resize is harmless
 * because the min/max/default-size props still drive the layout.
 */
function resizePanelSafely(panelRef: ResizablePanelRef, size: number) {
  requestAnimationFrame(() => {
    try {
      const panel = panelRef.value
      if (!panel || Math.abs(panel.getSize() - size) < 0.01)
        return
      panel.resize(size)
    }
    catch {
      // Panel not registered in the group layout yet; props still apply.
    }
  })
}

function redistributePanelSizes() {
  const cssTarget = cssPanelTargetSize.value
  const rightTarget = rightPanelTargetSize.value
  const emojiTarget = emojiPanelTargetSize.value
  const contentSpace = contentPanelTargetSize.value

  const mode = viewMode.value
  if (mode === `edit`) {
    resizePanelSafely(editorResizablePanelRef, contentSpace)
    resizePanelSafely(previewResizablePanelRef, 0)
  }
  else if (mode === `preview`) {
    resizePanelSafely(editorResizablePanelRef, 0)
    resizePanelSafely(previewResizablePanelRef, contentSpace)
  }
  else {
    const half = contentSpace / 2
    resizePanelSafely(editorResizablePanelRef, half)
    resizePanelSafely(previewResizablePanelRef, half)
  }

  resizePanelSafely(cssEditorPanelRef, cssTarget)
  resizePanelSafely(rightSliderPanelRef, rightTarget)
  resizePanelSafely(emojiManagerPanelRef, emojiTarget)
}

watch(viewMode, redistributePanelSizes)

watch(() => uiStore.isShowCssEditor, (open) => {
  if (open) {
    uiStore.isOpenRightSlider = false
    uiStore.isOpenEmojiManager = false
  }
  redistributePanelSizes()
})

watch(isOpenRightSlider, (open) => {
  if (open) {
    uiStore.isShowCssEditor = false
    uiStore.isOpenEmojiManager = false
  }
  redistributePanelSizes()
})

watch(() => uiStore.isOpenEmojiManager, (open) => {
  if (open) {
    hasMountedEmojiManager.value = true
    uiStore.isShowCssEditor = false
    uiStore.isOpenRightSlider = false
  }
  nextTick(redistributePanelSizes)
})

watch(isOpenPostSlider, (open) => {
  if (isMobile.value)
    return
  resizePanelSafely(postSliderPanelRef, open ? sidebarTargetSize.value : 0)
})

watch(isMobile, (mobile) => {
  if (mobile) {
    uiStore.isOpenPostSlider = false
    resizePanelSafely(postSliderPanelRef, 0)
  }
  else if (isOpenPostSlider.value) {
    resizePanelSafely(postSliderPanelRef, sidebarTargetSize.value)
  }
}, { immediate: true })

onMounted(() => {
  if (uiStore.isShowCssEditor) {
    uiStore.isOpenRightSlider = false
    uiStore.isOpenEmojiManager = false
  }
  redistributePanelSizes()
  if (!isMobile.value && isOpenPostSlider.value)
    resizePanelSafely(postSliderPanelRef, sidebarTargetSize.value)

  // Warm the deferred chunk after startup so the first panel open is instant.
  if (`requestIdleCallback` in window)
    window.requestIdleCallback(() => void loadEmojiManagerPanel(), { timeout: 2000 })
  else
    setTimeout(() => void loadEmojiManagerPanel(), 600)

  // Warm up the async post-slider chunk while idle: fetches the chunk in prod,
  // and in dev finishes the on-demand transform before the user opens the panel.
  const preloadPostSlider = () => { void import('@/components/editor/post-slider/index.vue') }
  if (typeof window.requestIdleCallback === `function`)
    window.requestIdleCallback(() => preloadPostSlider())
  else
    setTimeout(preloadPostSlider, 3000)
})

const isImgLoading = computed(() => unref(editorPanelCompRef.value?.isImgLoading) ?? false)

watch(sidebarTargetSize, () => {
  if (!isMobile.value && isOpenPostSlider.value)
    resizePanelSafely(postSliderPanelRef, sidebarTargetSize.value)
})

function resetLayout() {
  uiStore.isShowCssEditor = false
  uiStore.isOpenRightSlider = false
  uiStore.isOpenEmojiManager = false
  uiStore.isOpenFolderPanel = false
  uiStore.isOpenPostSlider = true
  uiStore.setViewMode(`split`)
  redistributePanelSizes()
  resizePanelSafely(postSliderPanelRef, isMobile.value ? 0 : sidebarTargetSize.value)
}
</script>

<template>
  <div ref="editorShell" class="container flex flex-col">
    <Progress v-if="isImgLoading" indeterminate class="absolute left-0 right-0 rounded-none" style="height: 2px;" />
    <EditorHeader
      :brand-width="headerBrandWidth"
      @start-copy="startCopy"
      @end-copy="endCopy"
      @reset-layout="resetLayout"
    />

    <main class="container-main flex flex-1 flex-col">
      <div
        class="container-main-section border-radius-10 relative flex flex-1 overflow-hidden border-x border-b"
      >
        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel
            ref="postSliderPanelRef"
            class="post-slider-panel"
            :default-size="!isMobile && isOpenPostSlider ? sidebarTargetSize : 0"
            :max-size="!isMobile && isOpenPostSlider ? sidebarMaxSize : 0"
            :min-size="!isMobile && isOpenPostSlider ? sidebarMinSize : 0"
          >
            <PostSlider v-if="isOpenPostSlider" />
          </ResizablePanel>
          <ResizableHandle class="hidden md:block" />
          <ResizablePanel
            class="folder-panel"
            :default-size="!isMobile && isOpenFolderPanel ? 15 : 0"
            :max-size="!isMobile && isOpenFolderPanel ? 25 : 0"
            :min-size="!isMobile && isOpenFolderPanel ? 10 : 0"
          >
            <FolderSourcePanel v-if="isOpenFolderPanel" />
          </ResizablePanel>
          <ResizableHandle v-if="!isMobile && isOpenFolderPanel" class="hidden md:block" />

          <ResizablePanel :min-size="30">
            <div class="writing-workspace">
              <div class="writing-panels">
                <ResizablePanelGroup direction="horizontal">
                  <ResizablePanel
                    ref="editorResizablePanelRef"
                    :order="1"
                    :default-size="viewMode === 'preview' ? 0 : viewMode === 'edit' ? 100 : 50"
                    :min-size="editorPanelConfig.min"
                    :max-size="editorPanelConfig.max"
                    collapsible
                    :collapsed-size="0"
                  >
                    <div class="writing-column editor-column">
                      <WritingToolbar />
                      <div class="column-body">
                        <EditorPanel ref="editorPanelCompRef" />
                      </div>
                    </div>
                  </ResizablePanel>
                  <ResizableHandle v-show="viewMode === 'split'" />

                  <ResizablePanel
                    ref="previewResizablePanelRef"
                    :order="2"
                    :default-size="viewMode === 'edit' ? 0 : viewMode === 'preview' ? 100 : 50"
                    :min-size="previewPanelConfig.min"
                    :max-size="previewPanelConfig.max"
                    collapsible
                    :collapsed-size="0"
                  >
                    <div class="writing-column preview-column">
                      <div class="column-heading">
                        <span><span class="column-dot preview-dot" />实时预览</span><small>{{ uiStore.previewDevice === 'mobile' ? '手机 · 375px' : '自适应宽度' }}</small>
                      </div>
                      <div class="column-body">
                        <PreviewPanel
                          ref="previewPanelCompRef"
                          :back-light="backLight"
                          :is-coping="isCoping"
                          :on-content-click="handlePreviewContentClick"
                        />
                      </div>
                    </div>
                  </ResizablePanel>

                  <ResizableHandle v-show="!isMobile && uiStore.isShowCssEditor" class="hidden md:block" />
                  <ResizablePanel
                    ref="cssEditorPanelRef"
                    :order="3"
                    :default-size="0"
                    :min-size="!isMobile && uiStore.isShowCssEditor ? 10 : 0"
                    :max-size="!isMobile && uiStore.isShowCssEditor ? 60 : 0"
                    collapsible
                    :collapsed-size="0"
                  >
                    <CssEditor v-if="!isMobile && uiStore.isShowCssEditor" />
                  </ResizablePanel>

                  <ResizableHandle v-show="!isMobile && isOpenRightSlider" class="hidden md:block right-slider-handle" />
                  <ResizablePanel
                    ref="rightSliderPanelRef"
                    class="right-slider-panel"
                    :order="4"
                    :default-size="0"
                    :min-size="!isMobile && isOpenRightSlider ? Math.min(settingsTargetSize, 18) : 0"
                    :max-size="!isMobile && isOpenRightSlider ? 60 : 0"
                    collapsible
                    :collapsed-size="0"
                    @collapse="isOpenRightSlider = false"
                  >
                    <RightSlider v-if="!isMobile && isOpenRightSlider" />
                  </ResizablePanel>

                  <ResizableHandle v-show="!isMobile && uiStore.isOpenEmojiManager" class="hidden md:block right-slider-handle" />
                  <!-- Stable constraints avoid re-deriving defaults on every toggle. -->
                  <ResizablePanel
                    ref="emojiManagerPanelRef"
                    class="emoji-manager-panel"
                    :order="5"
                    :default-size="0"
                    :min-size="EMOJI_PANEL_MIN_SIZE"
                    :max-size="EMOJI_PANEL_MAX_SIZE"
                    collapsible
                    :collapsed-size="0"
                    @collapse="uiStore.isOpenEmojiManager = false"
                  >
                    <EmojiManagerPanel v-if="!isMobile && hasMountedEmojiManager" />
                  </ResizablePanel>
                </ResizablePanelGroup>
              </div>

              <CssEditor v-if="isMobile" />
              <RightSlider v-if="isMobile" />
              <EmojiManagerPanel v-if="isMobile" />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <MaterialLibraryDialog v-if="isShowUploadImgDialog && materialLibraryEnabled" />
      <UploadImgDialog v-else-if="isShowUploadImgDialog" @upload-image="handleUploadImage" />

      <TableEditDialog v-if="isShowTableEditDialog" />

      <ImportMarkdownDialog v-if="isShowImportMdDialog" />

      <LocalImageUploadDialog v-if="isShowLocalImageUpload" />

      <FormulaEditorDialog v-if="isShowFormulaEditorDialog" />

      <TemplateDialog v-if="isShowTemplateDialog" />

      <CustomComponentDialog v-if="isShowComponentDialog" />

      <MarketplaceDialog v-if="isShowMarketplaceDialog" />
    </main>

    <Footer />
  </div>
</template>

<style lang="less" scoped>
@import url('../../assets/less/app.less');
</style>

<style lang="less" scoped>
.container {
  height: 100%;
  min-width: 100%;
  padding: 0;
}

.container-main {
  overflow: hidden;
}

.writing-workspace,
.writing-column {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  min-width: 0;
}
.writing-panels,
.column-body {
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}
.column-heading {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 12px;
  height: 35px;
  padding: 0 16px;
  border-bottom: 1px solid hsl(var(--border) / 0.65);
  color: hsl(var(--muted-foreground));
  font-size: 11px;
  background: hsl(var(--background));
}
.column-heading > span:first-child {
  display: inline-flex;
  gap: 7px;
  align-items: center;
  white-space: nowrap;
  color: hsl(var(--foreground) / 0.8);
  font-weight: 500;
}
.column-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.column-heading small {
  margin-left: auto;
  white-space: nowrap;
  font-size: 10px;
}
.column-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #8c98a6;
}
.preview-dot {
  background: #428b83;
}
.preview-column .column-body {
  background: hsl(var(--muted) / 0.35);
}
.preview-column :deep(.preview) {
  background: hsl(var(--background));
  box-shadow: 0 3px 16px rgb(0 0 0 / 0.045);
}

.right-slider-panel {
  transition: flex-grow 300ms cubic-bezier(0.16, 1, 0.3, 1);
}

.post-slider-panel {
  transition: flex-grow 300ms cubic-bezier(0.16, 1, 0.3, 1);
}

.folder-panel {
  transition: flex-grow 300ms cubic-bezier(0.16, 1, 0.3, 1);
}

.right-slider-handle {
  transition: opacity 300ms cubic-bezier(0.16, 1, 0.3, 1);
}
</style>
