<script setup lang="ts">
import CodemirrorEditor from '@/components/editor/CodemirrorEditor.vue'
import CommandPalette from '@/components/editor/dialogs/CommandPalette.vue'
import ConfirmDialog from '@/components/shared/confirm-dialog/ConfirmDialog.vue'
import { Toaster } from '@/components/ui/sonner'
import { useCommandPaletteHotkey } from '@/composables/useCommandPaletteHotkey'
import { usePreferencesHotkey } from '@/composables/usePreferencesHotkey'
import { useUIStore } from '@/stores/ui'
import { useWorkspaceStore } from '@/stores/workspace'

const uiStore = useUIStore()
const workspace = useWorkspaceStore()
onMounted(() => { void workspace.start() })
onUnmounted(() => workspace.close())

function sharedHistoryKey(event: KeyboardEvent) {
  if (!workspace.enabled || !(event.ctrlKey || event.metaKey) || event.altKey)
    return
  const target = event.target as HTMLElement | null
  if (target?.closest('input, textarea, [contenteditable="true"]') && !target.closest('.cm-editor'))
    return
  const key = event.key.toLowerCase()
  if (key !== 'z' && key !== 'y')
    return
  event.preventDefault()
  event.stopImmediatePropagation()
  workspace.history(key === 'y' || event.shiftKey ? 'redo' : 'undo')
}
onMounted(() => document.addEventListener('keydown', sharedHistoryKey, true))
onUnmounted(() => document.removeEventListener('keydown', sharedHistoryKey, true))
const { isDark } = storeToRefs(uiStore)

usePlatformEnv()
useAccountSyncBootstrap()
useDeepLinkImport()
useCommandPaletteHotkey()
usePreferencesHotkey()
</script>

<template>
  <CodemirrorEditor />
  <div v-if="workspace.enabled && !workspace.ready" class="fixed inset-0 z-[200] flex items-center justify-center bg-background/95" role="status">
    <div class="text-center">
      <p>{{ workspace.label }}</p>
      <p v-if="workspace.error" class="mt-2 text-sm text-muted-foreground">
        {{ workspace.error }}
      </p>
    </div>
  </div>

  <CommandPalette />

  <ConfirmDialog />

  <Toaster
    rich-colors
    position="top-center"
    :duration="1200"
    :visible-toasts="1"
    :theme="isDark ? 'dark' : 'light'"
  />
</template>
