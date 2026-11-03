<script setup lang="ts">
import type { CustomComponentDef } from '@md/shared/types'
import { componentPreviewDocument } from '@/lib/article-studio/component-preview'
import { useThemeStore } from '@/stores/theme'

const props = defineProps<{ component: CustomComponentDef }>()
const theme = useThemeStore()
const documentHtml = computed(() => componentPreviewDocument(props.component, {
  primaryColor: theme.primaryColor,
  fontFamily: theme.fontFamily,
  fontSize: theme.fontSize,
  lineHeight: theme.lineHeight,
  presetId: theme.articlePresetId,
}))
</script>

<template>
  <div class="component-thumbnail" aria-hidden="true">
    <iframe :srcdoc="documentHtml" sandbox="" :title="`${component.name} 缩略预览`" tabindex="-1" loading="lazy" />
  </div>
</template>

<style scoped>
.component-thumbnail {
  position: relative;
  height: 124px;
  overflow: hidden;
  background: #fff;
  border-bottom: 1px solid #e1e7e4;
  pointer-events: none;
}
.component-thumbnail iframe {
  display: block;
  width: 340px;
  height: 220px;
  border: 0;
  transform: scale(0.68);
  transform-origin: top left;
  pointer-events: none;
}
</style>
