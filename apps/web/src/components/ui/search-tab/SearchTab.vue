<script setup lang="ts">
import type { DecorationSet } from '@codemirror/view'
import { Compartment, StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'
import { CaseSensitive, ChevronDown, ChevronRight, ChevronUp, Regex, Replace, ReplaceAll, WholeWord, X } from '@lucide/vue'

const props = defineProps<{
  editorView: EditorView
}>()

const { t } = useI18n()

const showSearchTab = ref(false)
const searchInputRef = ref<{ focus: () => void, select: () => void } | null>(null)
const searchWord = ref(``)
const isRegex = ref(false)
const isCaseSensitive = ref(false)
const findInSelection = ref(false)
const indexOfMatch = ref(0)
const showReplace = ref(false)
const replaceWord = ref(``)

interface MatchRange { from: number, to: number }

const selectionRange = shallowRef<MatchRange | null>(null)
const documentText = shallowRef(props.editorView.state.doc)
const pattern = computed(() => {
  if (!searchWord.value)
    return null
  const source = isRegex.value ? searchWord.value : searchWord.value.replace(/[.*+?^${}()|[\]\\]/g, `\\$&`)
  try {
    return new RegExp(source, isCaseSensitive.value ? `gm` : `gmi`)
  }
  catch {
    return null
  }
})

const matchPositions = computed<MatchRange[]>(() => {
  if (!showSearchTab.value || !pattern.value)
    return []
  const doc = documentText.value
  const scope = findInSelection.value ? selectionRange.value : null
  const from = scope?.from ?? 0
  const content = doc.sliceString(from, scope?.to ?? doc.length)
  const matches: MatchRange[] = []
  for (const match of content.matchAll(pattern.value)) {
    if (match[0].length)
      matches.push({ from: from + match.index, to: from + match.index + match[0].length })
  }
  return matches
})
const numberOfMatches = computed(() => matchPositions.value.length)
const currentMatchPosition = computed(() => matchPositions.value[indexOfMatch.value])

const searchExtension = new Compartment()
const setSearchHighlights = StateEffect.define<DecorationSet>()
const searchHighlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(highlights, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setSearchHighlights))
        return effect.value
    }
    return highlights.map(tr.changes)
  },
  provide: f => EditorView.decorations.from(f),
})

onMounted(() => {
  props.editorView.dispatch({
    effects: StateEffect.appendConfig.of(searchExtension.of([
      searchHighlightField,
      EditorView.updateListener.of(({ docChanged, changes, state }) => {
        if (!docChanged)
          return
        documentText.value = state.doc
        const range = selectionRange.value
        if (range)
          selectionRange.value = { from: changes.mapPos(range.from, -1), to: changes.mapPos(range.to, 1) }
      }),
    ])),
  })
})

onBeforeUnmount(() => {
  props.editorView.dispatch({ effects: searchExtension.reconfigure([]) })
})

watch(numberOfMatches, (count) => {
  indexOfMatch.value = Math.max(0, Math.min(indexOfMatch.value, count - 1))
})

watch([matchPositions, indexOfMatch], () => {
  const marks = matchPositions.value.map(({ from, to }, index) =>
    Decoration.mark({ class: index === indexOfMatch.value ? `cm-searchMatch-selected` : `cm-searchMatch` }).range(from, to))
  props.editorView.dispatch({ effects: setSearchHighlights.of(Decoration.set(marks)) })
})

function revealMatch() {
  const match = currentMatchPosition.value
  if (match)
    props.editorView.dispatch({ selection: { anchor: match.from }, scrollIntoView: true })
}

// A document edit refreshes counts and highlights without pulling the caret away from the edit.
watch([showSearchTab, searchWord, isRegex, isCaseSensitive, findInSelection], () => {
  indexOfMatch.value = 0
  revealMatch()
})

function nextMatch(direction = 1) {
  const count = numberOfMatches.value
  if (count) {
    indexOfMatch.value = (indexOfMatch.value + direction + count) % count
    revealMatch()
  }
}

function captureSelection() {
  const { from, to, empty } = props.editorView.state.selection.main
  return empty ? null : { from, to }
}

function toggleFindInSelection() {
  if (!findInSelection.value) {
    selectionRange.value = captureSelection() ?? selectionRange.value
    if (!selectionRange.value)
      return
  }
  findInSelection.value = !findInSelection.value
}

async function openSearch(word: string, replace = false) {
  selectionRange.value = captureSelection()
  findInSelection.value = false
  if (word || replace)
    searchWord.value = word
  if (replace)
    showReplace.value = true
  showSearchTab.value = true
  await nextTick()
  searchInputRef.value?.focus()
  searchInputRef.value?.select()
}

watch(showSearchTab, (open) => {
  if (!open) {
    showReplace.value = false
    findInSelection.value = false
    selectionRange.value = null
  }
})

function handleSearchInputKeyDown(e: KeyboardEvent) {
  if (e.key === `Enter` && !e.isComposing) {
    e.preventDefault()
    nextMatch(e.shiftKey ? -1 : 1)
  }
}

function handleReplaceInputKeyDown(e: KeyboardEvent) {
  if (e.key === `Enter` && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    handleReplace()
  }
}

function autoResizeTextarea(e: Event) {
  const el = e.target as HTMLTextAreaElement
  if (!el.value.includes(`\n`)) {
    el.style.height = `28px`
    return
  }
  el.style.height = `auto`
  el.style.height = `${Math.min(150, el.scrollHeight)}px`
}

function replacement({ from, to }: MatchRange) {
  const insert = isRegex.value && pattern.value
    ? props.editorView.state.sliceDoc(from, to).replace(pattern.value, replaceWord.value)
    : replaceWord.value
  return { from, to, insert }
}

function handleReplace() {
  const match = currentMatchPosition.value
  if (!match)
    return
  const change = replacement(match)
  props.editorView.dispatch({ changes: change, selection: { anchor: change.from + change.insert.length } })
  nextTick(revealMatch)
}

function handleReplaceAll() {
  if (numberOfMatches.value)
    props.editorView.dispatch({ changes: matchPositions.value.map(replacement) })
}

defineExpose({ showSearchTab, openSearch })
</script>

<template>
  <Transition name="slide-down">
    <div
      v-if="showSearchTab"
      class="bg-background absolute right-0 top-0 z-50 flex max-w-[calc(100%-1rem)] gap-1 rounded-lg border px-2 py-1 shadow-md transition-all"
      :class="showReplace ? 'items-start' : 'items-center'"
    >
      <Button
        variant="ghost"
        :title="t('search.toggleReplace')"
        :aria-label="t('search.toggleReplace')"
        class="h-7 w-5 flex items-center justify-center p-0"
        @click="showReplace = !showReplace"
      >
        <component :is="showReplace ? ChevronDown : ChevronRight" class="h-3.5 w-3.5" />
      </Button>

      <div class="grid min-w-0 flex-1 grid-cols-[1fr_auto] items-center gap-0.5">
        <div class="relative min-w-0">
          <Input
            ref="searchInputRef"
            v-model="searchWord"
            :placeholder="t('search.find')"
            class="h-7 w-full min-w-0 pr-16 text-sm"
            @keydown="handleSearchInputKeyDown"
          />
          <div class="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
            <Button
              variant="ghost"
              size="xs"
              :title="t('search.caseSensitive')"
              :aria-label="t('search.caseSensitive')"
              class="h-5 w-5 p-0"
              :class="{ 'bg-accent': isCaseSensitive }"
              @click="isCaseSensitive = !isCaseSensitive"
            >
              <CaseSensitive class="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="xs"
              :title="t('search.regex')"
              :aria-label="t('search.regex')"
              class="h-5 w-5 p-0"
              :class="{ 'bg-accent': isRegex }"
              @click="isRegex = !isRegex"
            >
              <Regex class="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="xs"
              :title="t('search.findInSelection')"
              :aria-label="t('search.findInSelection')"
              :aria-pressed="findInSelection"
              class="h-5 w-5 p-0"
              :class="{ 'bg-accent': findInSelection }"
              @click="toggleFindInSelection"
            >
              <WholeWord class="h-3 w-3" />
            </Button>
          </div>
        </div>
        <div class="flex items-center gap-1">
          <span class="w-10 select-none text-center text-xs">
            {{ numberOfMatches ? indexOfMatch + 1 : 0 }}/{{ numberOfMatches }}
          </span>
          <Button
            variant="ghost"
            size="xs"
            :title="t('search.previous')"
            :aria-label="t('search.previous')"
            class="h-6 w-6 p-0"
            @click="nextMatch(-1)"
          >
            <ChevronUp class="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="xs"
            :title="t('search.next')"
            :aria-label="t('search.next')"
            class="h-6 w-6 p-0"
            @click="nextMatch()"
          >
            <ChevronDown class="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="xs"
            :title="t('search.close')"
            :aria-label="t('search.close')"
            class="h-6 w-6 p-0"
            @click="showSearchTab = false"
          >
            <X class="h-3 w-3" />
          </Button>
        </div>

        <template v-if="showReplace">
          <textarea
            v-model="replaceWord"
            :placeholder="t('search.replacePlaceholder')"
            class="mt-0.5 min-w-0 rounded-md border border-input bg-background px-3 py-[7px] text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring resize-none leading-none overflow-hidden max-h-[150px]"
            style="height: 28px; min-height: 28px"
            @keydown="handleReplaceInputKeyDown"
            @input="autoResizeTextarea($event)"
          />
          <div class="flex items-start gap-1 mt-0.5 self-start">
            <Button
              variant="ghost"
              size="xs"
              :title="t('search.replace')"
              :aria-label="t('search.replace')"
              class="h-6 w-6 p-0"
              @click="handleReplace"
            >
              <Replace class="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="xs"
              :title="t('search.replaceAll')"
              :aria-label="t('search.replaceAll')"
              class="h-6 w-6 p-0"
              @click="handleReplaceAll"
            >
              <ReplaceAll class="h-3 w-3" />
            </Button>
          </div>
        </template>
      </div>
    </div>
  </Transition>
</template>

<style scoped lang="less">
.slide-down-enter-active,
.slide-down-leave-active {
  transition: transform 0.2s ease, opacity 0.2s ease;
}
.slide-down-enter-from,
.slide-down-leave-to {
  transform: translateY(-100%);
  opacity: 0;
}
</style>

<style lang="less">
.cm-searchMatch {
  background-color: rgba(255, 237, 100, 0.4);
  border-radius: 2px;
  box-shadow: 0 0 0 1px rgba(255, 193, 7, 0.3);
}

.cm-searchMatch-selected {
  background-color: rgba(255, 152, 0, 0.6);
  border-radius: 2px;
  box-shadow: 0 0 0 2px rgba(255, 152, 0, 0.8);
  font-weight: 500;
}

.dark .cm-searchMatch {
  background-color: rgba(255, 235, 59, 0.3);
  box-shadow: 0 0 0 1px rgba(255, 235, 59, 0.4);
}

.dark .cm-searchMatch-selected {
  background-color: rgba(255, 152, 0, 0.5);
  box-shadow: 0 0 0 2px rgba(255, 152, 0, 0.7);
}
</style>
