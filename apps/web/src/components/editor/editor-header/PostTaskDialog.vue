<script setup lang="ts">
import type { CoseAddTaskData, CoseTaskStatus } from '@/types/cose'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { runPublishTasks } from '@/services/publish/tasks'

const props = defineProps<{
  tasks: CoseAddTaskData[]
  open: boolean
}>()

const emit = defineEmits<{ 'update:open': [value: boolean], 'busy': [value: boolean] }>()

const { t } = useI18n()

const dialogVisible = computed({
  get: () => props.open,
  set: value => emit(`update:open`, value),
})

const taskStatus = ref<CoseTaskStatus | null>(null)
const submitting = ref(false)

async function startPost() {
  if (submitting.value || !props.tasks.length)
    return
  submitting.value = true
  emit('busy', true)
  taskStatus.value = null
  try {
    await runPublishTasks(props.tasks, window.$cose ?? {}, (status) => { taskStatus.value = status })
  }
  finally {
    submitting.value = false
    emit('busy', false)
  }
}

watch(() => props.open, (newVal) => {
  if (newVal) {
    startPost()
  }
})
</script>

<template>
  <Dialog v-model:open="dialogVisible">
    <DialogContent class="!max-w-[95vw] !w-[min(560px,95vw)] max-h-[85vh] flex flex-col overflow-hidden">
      <DialogHeader>
        <DialogTitle>{{ t('postTask.title') }}</DialogTitle>
      </DialogHeader>

      <div class="mt-4">
        <div v-if="!taskStatus" class="py-4 text-center">
          {{ t('postTask.waiting') }}
        </div>
        <div v-else class="max-h-[400px] flex flex-col overflow-y-auto">
          <div
            v-for="account in taskStatus?.accounts"
            :key="account.uid + account.displayName"
            class="border-b py-4 last:border-b-0"
          >
            <div class="mb-2 flex items-center gap-2">
              <img
                v-if="account.icon"
                :src="account.icon"
                class="object-cover h-5 w-5"
                alt=""
              >
              <span>{{ account.title }} - {{ account.displayName || account.home }}</span>
            </div>
            <div
              class="w-full flex-1 gap-2 overflow-auto pl-7 text-sm" :class="{
                'text-yellow-600': account.status === 'uploading',
                'text-red-600': account.status === 'failed',
                'text-green-600': account.status === 'done',
              }"
            >
              <template v-if="account.status === 'uploading'">
                {{ account.msg || t('postTask.publishing') }}
              </template>

              <template v-if="account.status === 'failed'">
                {{ t('postTask.syncFailed', { error: account.error }) }}
              </template>

              <template v-if="account.status === 'done' && account.editResp">
                {{ t('postTask.syncSuccess') }}
                <a
                  v-if="account.type !== 'wordpress' && account.editResp"
                  :href="account.editResp.draftLink"
                  class="ml-2 text-blue-500 hover:underline"
                  referrerPolicy="no-referrer"
                  target="_blank" rel="noopener noreferrer"
                >{{ t('postTask.viewDraft') }}</a>
              </template>
            </div>
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>

<style scoped>
.account-item {
  margin-bottom: 1rem;
}
</style>
