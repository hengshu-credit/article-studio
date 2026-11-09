import type { Ref } from 'vue'
import { computed, ref } from 'vue'

export interface PublishMetadata {
  title: string
  desc: string
  thumb: string
}

export interface PublishDraft {
  common: PublishMetadata
  channels: Record<string, PublishMetadata>
  selected: string[]
  active: string
}

export const PUBLISH_DRAFTS_KEY = `MD__article_publish_drafts_v1`
export type PublishDraftMap = Record<string, PublishDraft>

function metadata(value: unknown, fallback: PublishMetadata): PublishMetadata {
  const source = value && typeof value === 'object' ? value as Partial<PublishMetadata> : {}
  return {
    title: typeof source.title === 'string' ? source.title : fallback.title,
    desc: typeof source.desc === 'string' ? source.desc : fallback.desc,
    thumb: typeof source.thumb === 'string' ? source.thumb : fallback.thumb,
  }
}

/** Only user-editable metadata is persisted; article HTML and account state stay live. */
export function createPublishDraftSession(saved: Ref<PublishDraftMap>) {
  const articleId = ref('')
  const common = ref<PublishMetadata>({ title: '', desc: '', thumb: '' })
  const channels = ref<Record<string, PublishMetadata>>({})
  const selected = ref<string[]>([])
  const active = ref('')
  const fields = computed(() => channels.value[active.value] ?? common.value)

  function persist() {
    if (!articleId.value)
      return
    saved.value = { ...saved.value, [articleId.value]: {
      common: { ...common.value },
      channels: Object.fromEntries(Object.entries(channels.value).map(([key, value]) => [key, { ...value }])),
      selected: [...selected.value],
      active: active.value,
    } }
  }

  function open(id: string, defaults: PublishMetadata) {
    articleId.value = id
    const previous = saved.value?.[id]
    common.value = metadata(previous?.common, defaults)
    channels.value = Object.fromEntries(Object.entries(previous?.channels ?? {}).map(([key, value]) => [key, metadata(value, common.value)]))
    selected.value = Array.isArray(previous?.selected) ? previous.selected.filter(value => typeof value === 'string') : []
    active.value = selected.value.includes(previous?.active) ? previous.active : selected.value[0] ?? ''
  }

  function select(types: string[]) {
    selected.value = [...new Set(types)]
    for (const type of selected.value) {
      if (!channels.value[type])
        channels.value[type] = { ...common.value }
    }
    if (!selected.value.includes(active.value))
      active.value = selected.value[0] ?? ''
    persist()
  }

  function activate(type: string) {
    active.value = selected.value.includes(type) ? type : ''
    persist()
  }

  function update(patch: Partial<PublishMetadata>) {
    const next = metadata({ ...fields.value, ...patch }, common.value)
    if (active.value)
      channels.value[active.value] = next
    else
      common.value = next
    persist()
  }

  function snapshot(types: string[]): Record<string, PublishMetadata> {
    return Object.fromEntries(types.map(type => [type, { ...(channels.value[type] ?? common.value) }]))
  }

  return { articleId, fields, selected, active, open, select, activate, update, snapshot }
}
