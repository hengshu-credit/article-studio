<script setup lang="ts">
import type { Material } from '@/services/materials/types'
import { ImagePlus, Loader2, RefreshCw, Search, UploadCloud } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { listMaterials, uploadMaterial } from '@/services/materials/client'
import { materialMarkdown, MATERIALS_CHANGED_EVENT } from '@/services/materials/types'
import { useEditorStore } from '@/stores/editor'
import { usePostStore } from '@/stores/post'
import { useUIStore } from '@/stores/ui'

const props = withDefaults(defineProps<{ open?: boolean, selectOnly?: boolean }>(), { open: undefined, selectOnly: false })
const emit = defineEmits<{ 'update:open': [value: boolean], 'select': [material: Material] }>()
const ui = useUIStore()
const visible = computed({
  get: () => props.open ?? ui.isShowUploadImgDialog,
  set: (value: boolean) => {
    if (props.open === undefined)
      ui.isShowUploadImgDialog = value
    else
      emit('update:open', value)
  },
})
const editor = useEditorStore()
const posts = usePostStore()
const items = ref<Material[]>([])
const selected = ref<Material | null>(null)
const search = ref('')
const total = ref(0)
const totalBytes = ref(0)
const loading = ref(false)
const uploading = ref(false)
const progress = ref('')
const error = ref('')
const uploadErrors = ref<string[]>([])
const dragover = ref(false)
const fileInput = useTemplateRef<HTMLInputElement>('fileInput')
let requestGeneration = 0
let searchTimer: ReturnType<typeof setTimeout> | undefined
let poll: ReturnType<typeof setInterval> | undefined
let disposed = false

function formatSize(bytes: number): string {
  if (bytes === 0)
    return '0 KB'
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

async function refresh(append = false, preserve = false) {
  const generation = ++requestGeneration
  loading.value = true
  try {
    const page = await listMaterials(search.value.trim(), append ? items.value.length : 0)
    if (generation !== requestGeneration || disposed)
      return
    items.value = append
      ? [...items.value, ...page.items.filter(item => !items.value.some(existing => existing.hash === item.hash))]
      : preserve ? [...page.items, ...items.value.filter(item => !page.items.some(existing => existing.hash === item.hash))] : page.items
    total.value = page.total
    totalBytes.value = page.totalBytes
    error.value = ''
  }
  catch (cause) {
    if (generation === requestGeneration)
      error.value = cause instanceof Error ? cause.message : '素材加载失败'
  }
  finally {
    if (generation === requestGeneration)
      loading.value = false
  }
}

async function uploadFiles(files: File[]) {
  if (uploading.value || !files.length)
    return
  uploading.value = true
  uploadErrors.value = []
  let added = 0
  let reused = 0
  for (const [index, file] of files.entries()) {
    progress.value = `正在入库 ${index + 1} / ${files.length}`
    try {
      const result = await uploadMaterial(file)
      selected.value = result.material
      result.reused ? reused++ : added++
    }
    catch (cause) {
      uploadErrors.value.push(`${file.name}：${cause instanceof Error ? cause.message : '上传失败'}`)
    }
  }
  uploading.value = false
  progress.value = `新增 ${added} 张，复用 ${reused} 张${uploadErrors.value.length ? `，失败 ${uploadErrors.value.length} 张` : ''}`
  search.value = ''
  await refresh()
}

function onFiles(event: Event) {
  const input = event.target as HTMLInputElement
  void uploadFiles(Array.from(input.files ?? []))
  input.value = ''
}

function onDrop(event: DragEvent) {
  dragover.value = false
  void uploadFiles(Array.from(event.dataTransfer?.files ?? []))
}

function onPaste(event: ClipboardEvent) {
  const files = Array.from(event.clipboardData?.items ?? []).filter(item => item.kind === 'file').map(item => item.getAsFile()).filter((file): file is File => file !== null)
  if (files.length) {
    event.preventDefault()
    void uploadFiles(files)
  }
}

function insert(material: Material) {
  if (props.selectOnly) {
    emit('select', material)
    visible.value = false
    return
  }
  if (!posts.currentPost || !editor.editor)
    return
  editor.insertAtCursor(`\n${materialMarkdown(material)}\n`)
  if (ui.viewMode === 'preview')
    ui.setViewMode(ui.isMobile ? 'edit' : 'split')
  visible.value = false
  void nextTick(() => editor.editor?.focus())
}

function refreshFromEvent() {
  if (!uploading.value)
    void refresh(false, true)
}

watch(search, () => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { void refresh() }, 200)
})
onMounted(() => {
  void refresh()
  window.addEventListener(MATERIALS_CHANGED_EVENT, refreshFromEvent)
  window.addEventListener('focus', refreshFromEvent)
  poll = setInterval(() => {
    if (document.visibilityState === 'visible' && !loading.value && !uploading.value)
      void refresh(false, true)
  }, 15000)
})
onUnmounted(() => {
  disposed = true
  clearTimeout(searchTimer)
  clearInterval(poll)
  window.removeEventListener(MATERIALS_CHANGED_EVENT, refreshFromEvent)
  window.removeEventListener('focus', refreshFromEvent)
})
</script>

<template>
  <Dialog v-model:open="visible">
    <DialogContent class="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-5xl">
      <div class="flex min-h-0 flex-1 flex-col gap-4" @paste="onPaste" @dragover.prevent="dragover = true" @dragleave.prevent="dragover = false" @drop.prevent.stop="onDrop">
        <DialogHeader>
          <DialogTitle>素材库</DialogTitle>
          <DialogDescription>图片自动入库，相同内容只保存一份。{{ selectOnly ? '选择素材用于当前图片选项。' : '选择素材即可插入当前文章。' }}</DialogDescription>
        </DialogHeader>
        <div class="flex flex-wrap items-center gap-2">
          <div class="relative min-w-40 flex-1">
            <Search class="absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <input v-model="search" aria-label="搜索素材" placeholder="按图片名称搜索" class="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-sm">
          </div>
          <Button variant="outline" size="icon" aria-label="刷新素材库" :disabled="loading" @click="refresh()">
            <RefreshCw class="size-4" :class="{ 'animate-spin': loading }" />
          </Button>
          <input ref="fileInput" type="file" multiple accept="image/png,image/jpeg,image/gif,image/webp" aria-label="选择素材文件" class="hidden" @change="onFiles">
          <Button :disabled="uploading" @click="fileInput?.click()">
            <Loader2 v-if="uploading" class="mr-2 size-4 animate-spin" />
            <UploadCloud v-else class="mr-2 size-4" />
            上传图片
          </Button>
        </div>
        <div class="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground" role="status">
          <span>共 {{ total }} 张 · 原图合计 {{ formatSize(totalBytes) }}</span>
          <span>{{ progress || '支持粘贴、多选和拖入 · PNG / JPEG / GIF / WebP · 每张 ≤ 10 MB' }}</span>
        </div>
        <p v-if="error" role="alert" class="text-sm text-destructive">
          {{ error }}
        </p>
        <div v-if="uploadErrors.length" role="alert" class="max-h-20 overflow-auto text-xs text-destructive">
          <p v-for="message in uploadErrors" :key="message">
            {{ message }}
          </p>
        </div>
        <div class="grid min-h-0 flex-1 gap-4 overflow-auto md:grid-cols-[1fr_260px]" :class="{ 'outline outline-2 outline-primary': dragover }">
          <div class="min-h-48 overflow-auto rounded-md border p-3">
            <div v-if="!items.length" class="flex h-48 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
              <ImagePlus class="size-9" />
              <p>{{ loading ? '正在加载素材…' : search ? '没有找到匹配的素材' : '将图片拖到这里，或在文章中直接粘贴图片' }}</p>
            </div>
            <div v-else class="grid grid-cols-2 gap-3 lg:grid-cols-3">
              <button v-for="material in items" :key="material.hash" type="button" class="overflow-hidden rounded-md border bg-muted/20 text-left hover:border-primary" :class="{ 'border-primary ring-1 ring-primary': selected?.hash === material.hash }" :aria-label="`预览素材：${material.name}`" :aria-pressed="selected?.hash === material.hash" @click="selected = material">
                <img :src="material.thumbnailUrl" :alt="material.name" class="h-28 w-full bg-muted object-contain" loading="lazy" decoding="async">
                <div class="p-2">
                  <p class="truncate text-xs font-medium" :title="material.name">
                    {{ material.name }}
                  </p>
                  <p class="mt-1 text-[11px] text-muted-foreground">
                    {{ material.width }} × {{ material.height }} · {{ formatSize(material.size) }}
                  </p>
                </div>
              </button>
            </div>
            <Button v-if="items.length < total" variant="outline" class="mt-3 w-full" :disabled="loading" @click="refresh(true)">
              加载更多
            </Button>
          </div>
          <div class="flex flex-col gap-3 rounded-md border p-3">
            <template v-if="selected">
              <img :src="selected.url" :alt="`素材预览：${selected.name}`" class="max-h-64 min-h-24 w-full rounded bg-muted object-contain">
              <p class="break-all text-sm font-medium">
                {{ selected.name }}
              </p>
              <p class="text-xs text-muted-foreground">
                {{ selected.width }} × {{ selected.height }} · {{ formatSize(selected.size) }}
              </p>
              <Button :disabled="!selectOnly && (!posts.currentPost || !editor.editor)" @click="insert(selected)">
                {{ selectOnly ? '使用此图片' : '插入正文' }}
              </Button>
              <p v-if="!selectOnly && !posts.currentPost" class="text-xs text-muted-foreground">
                请先新建或选择一篇文章。
              </p>
            </template>
            <p v-else class="my-auto py-8 text-center text-sm text-muted-foreground">
              {{ selectOnly ? '选择图片查看预览并使用' : '选择图片查看预览并插入文章' }}
            </p>
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
