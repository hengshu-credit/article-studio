<script setup lang="ts">
import { ImagePlus, Loader2, Upload } from '@lucide/vue'
import MaterialLibraryDialog from '@/components/editor/dialogs/MaterialLibraryDialog.vue'
import { useImageUploader } from '@/composables/useImageUploader'
import { materialLibraryEnabled } from '@/services/materials/client'

defineProps<{ modelValue: string, id: string, placeholder?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string], 'busy': [value: boolean] }>()
const libraryOpen = ref(false)
const error = ref('')
const input = useTemplateRef<HTMLInputElement>('fileInput')
const { upload, isUploading } = useImageUploader()
let disposed = false
onUnmounted(() => { disposed = true; emit('busy', false) })

async function onFile(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  target.value = ''
  if (!file || isUploading.value)
    return
  error.value = ''
  emit('busy', true)
  try {
    const url = await upload(file)
    if (!disposed)
      emit('update:modelValue', url)
  }
  catch (cause) {
    if (!disposed)
      error.value = cause instanceof Error ? cause.message : '图片上传失败'
  }
  finally {
    if (!disposed)
      emit('busy', false)
  }
}
</script>

<template>
  <div class="min-w-0 space-y-2">
    <Input :id="id" :model-value="modelValue" :placeholder="placeholder" :disabled="isUploading" @update:model-value="emit('update:modelValue', String($event))" />
    <div class="flex flex-wrap gap-2">
      <Button v-if="materialLibraryEnabled" type="button" variant="outline" size="sm" :disabled="isUploading" @click="libraryOpen = true">
        <ImagePlus class="mr-1 size-4" />从素材库选择
      </Button>
      <Button type="button" variant="outline" size="sm" :disabled="isUploading" @click="input?.click()">
        <Loader2 v-if="isUploading" class="mr-1 size-4 animate-spin" /><Upload v-else class="mr-1 size-4" />{{ isUploading ? '上传中…' : '上传文件' }}
      </Button>
      <slot />
      <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/gif,image/webp" aria-label="上传发布图片" class="hidden" @change="onFile">
    </div>
    <p v-if="error" role="alert" class="text-sm text-destructive">
      {{ error }}
    </p>
    <MaterialLibraryDialog v-if="libraryOpen" v-model:open="libraryOpen" select-only @select="emit('update:modelValue', $event.url)" />
  </div>
</template>
