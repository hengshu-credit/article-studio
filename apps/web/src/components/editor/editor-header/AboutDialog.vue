<script setup lang="ts">
import { ExternalLink, HelpCircle } from '@lucide/vue'
import { computed } from 'vue'
import officialAccountQr from '@/assets/images/contact-wechat-official-account.svg'
import wechatQr from '@/assets/images/contact-wechat.svg'
import PanelDialog from '@/components/shared/panel-dialog/PanelDialog.vue'
import { Button } from '@/components/ui/button'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const { t } = useI18n()

const dialogOpen = computed({
  get: () => props.open,
  set: (val: boolean) => emit(`update:open`, val),
})

const links = [
  { label: `GitHub · hengshu-credit`, url: `https://github.com/hengshu-credit` },
  { label: `hengshucredit.com`, url: `https://hengshucredit.com/` },
]
</script>

<template>
  <PanelDialog
    v-model:open="dialogOpen"
    :title="t('about.title')"
    :description="t('about.description')"
    :icon="HelpCircle"
    size="xl"
  >
    <div class="space-y-4 px-4 py-4 text-center sm:px-6">
      <p class="text-sm text-muted-foreground">
        {{ t('about.followHint') }}
      </p>
      <div class="grid grid-cols-1 min-[480px]:grid-cols-2 gap-4">
        <figure class="min-w-0 space-y-2">
          <img :src="wechatQr" :alt="t('about.wechatAlt')" class="mx-auto aspect-square w-full max-w-[200px] bg-white object-contain p-2" width="200" height="200">
          <figcaption class="text-sm font-medium">
            {{ t('about.wechatLabel') }}
          </figcaption>
        </figure>
        <figure class="min-w-0 space-y-2">
          <img :src="officialAccountQr" :alt="t('about.officialAlt')" class="mx-auto aspect-square w-full max-w-[200px] bg-white object-contain p-2" width="200" height="200">
          <figcaption class="text-sm font-medium">
            {{ t('about.officialLabel') }}
          </figcaption>
          <p class="text-xs text-muted-foreground">
            {{ t('about.officialHint') }}
          </p>
        </figure>
      </div>
      <div class="grid grid-cols-1 min-[480px]:grid-cols-2 gap-2 border-t pt-4">
        <Button
          v-for="link in links"
          :key="link.url"
          variant="outline"
          class="h-10 min-w-0 gap-1.5 px-2"
          as-child
        >
          <a :href="link.url" target="_blank" rel="noopener noreferrer">
            <ExternalLink class="size-3.5 shrink-0" />
            <span class="truncate text-xs sm:text-sm">{{ link.label }}</span>
          </a>
        </Button>
      </div>
    </div>
  </PanelDialog>
</template>
