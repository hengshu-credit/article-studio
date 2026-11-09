<script setup lang="ts">
import type { CustomComponentDef } from '@md/shared/types'
import { WECHAT_REFERENCE_PRESET } from '@article-studio/article-kit'
import { Compartment, StateEffect } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { Blocks, Bold, ChevronDown, Code, CodeXml, Image, IndentDecrease, Italic, Link, List, ListOrdered, Quote, Redo2, Search, Strikethrough, Table, Undo2 } from '@lucide/vue'
import { applyHeading, formatBold, formatCode, formatItalic, formatLink, formatStrikethrough } from '@md/shared/editor'
import ComponentThumbnail from '@/components/editor/ComponentThumbnail.vue'
import { useEditorRefresh } from '@/composables/useEditorRefresh'
import { useLocalizedAllComponents } from '@/composables/useLocalizedBuiltinComponents'
import { formatBlock, insertBlock, insertCodeFence, paragraphIndentState, toggleParagraphIndent } from '@/lib/article-studio/editor-actions'
import { materialLibraryEnabled } from '@/services/materials/client'
import { useEditorStore } from '@/stores/editor'
import { useThemeStore } from '@/stores/theme'
import { useUIStore } from '@/stores/ui'
import { useWorkspaceStore } from '@/stores/workspace'

const editor = useEditorStore()
const theme = useThemeStore()
const ui = useUIStore()
const workspace = useWorkspaceStore()
const { editorRefresh } = useEditorRefresh()
const components = useLocalizedAllComponents()
const componentOpen = ref(false)
const codeOpen = ref(false)
const query = ref(``)
const canAdjustIndent = ref(false)
const noIndent = ref(false)
const indentListener = new Compartment()
watch(() => editor.editor, (instance, _previous, onCleanup) => {
  if (!instance) {
    canAdjustIndent.value = false
    noIndent.value = false
    return
  }
  const view = toRaw(instance) as EditorView
  const updateState = () => {
    const state = paragraphIndentState(view.state)
    canAdjustIndent.value = state.available
    noIndent.value = state.noIndent
  }
  view.dispatch({ effects: StateEffect.appendConfig.of(indentListener.of(EditorView.updateListener.of((update) => {
    if (update.docChanged || update.selectionSet)
      updateState()
  }))) })
  updateState()
  onCleanup(() => view.dispatch({ effects: indentListener.reconfigure([]) }))
}, { immediate: true })
const labels: Record<string, string> = {
  ArticleLeadV1: `文章导读`,
  KeyFindingV1: `核心结论`,
  MetricCardV1: `指标卡`,
  MethodNoteV1: `方法说明`,
  FigureCaptionV1: `图注`,
  ArticleFooterV1: `文末信息`,
  WeChatIntroV1: `主题引言`,
  WeChatBannerV1: `栏目短句`,
  WeChatHighlightV1: `重点强调`,
  WeChatFigureV1: `报表图片`,
  WeChatFigureBannerV1: `图片与标语`,
  MpProfile: `公众号名片`,
  QRCodeBlock: `二维码`,
  AuthorBlock: `作者信息`,
  TipBlock: `提示块`,
  TableBlock: `数据表格`,
  InfoGrid: `信息网格`,
  BadgeGroup: `标签组`,
}
const preferredNames = computed(() => theme.articlePresetId === WECHAT_REFERENCE_PRESET ? [`WeChatFigureBannerV1`, `WeChatIntroV1`, `WeChatHighlightV1`, `MetricCardV1`] : [`ArticleLeadV1`, `KeyFindingV1`, `MetricCardV1`])
const filteredComponents = computed(() => {
  const rank = (name: string) => {
    const preferred = preferredNames.value.indexOf(name)
    return preferred >= 0 ? preferred : name.endsWith(`V1`) ? 10 : 20
  }
  return components.value
    .filter(item => !item.hidden && !item.inline && `${labels[item.name] || item.name} ${item.description || ``} ${item.name}`.toLowerCase().includes(query.value.toLowerCase()))
    .sort((a, b) => rank(a.name) - rank(b.name))
})
watch(componentOpen, (open) => {
  if (open)
    query.value = ``
})
const tools = [
  { label: `加粗`, hint: `加粗 · Ctrl+B`, icon: Bold, run: formatBold },
  { label: `斜体`, hint: `斜体 · Ctrl+I`, icon: Italic, run: formatItalic },
  { label: `删除线`, hint: `删除线`, icon: Strikethrough, run: formatStrikethrough },
  { label: `行内代码`, hint: `行内代码`, icon: Code, run: formatCode },
  { label: `引用`, hint: `引用段落`, icon: Quote, run: (view: EditorView) => formatBlock(view, `quote`) },
  { label: `无序列表`, hint: `无序列表`, icon: List, run: (view: EditorView) => formatBlock(view, `bullet`) },
  { label: `有序列表`, hint: `有序列表`, icon: ListOrdered, run: (view: EditorView) => formatBlock(view, `ordered`) },
  { label: `链接`, hint: `插入链接`, icon: Link, run: formatLink },
]

function run(action: (view: EditorView) => unknown) {
  if (!editor.editor)
    return
  if (ui.viewMode === `preview`)
    ui.setViewMode(`split`)
  // CodeMirror transactions depend on EditorState identity; do not pass a Vue proxy.
  const view = toRaw(editor.editor) as EditorView
  action(view)
  view.focus()
  nextTick(() => view.focus())
  editorRefresh({ force: true })
}
function headingChanged(event: Event) {
  const select = event.target as HTMLSelectElement
  const level = Number(select.value)
  run(view => level === 0 ? formatBlock(view, `paragraph`) : applyHeading(view, level))
  select.value = ``
}
function addComponent(def: CustomComponentDef) {
  const selected = editor.getSelection()
  let snippet = def.example || `<${def.name} />`
  if (selected && def.markdownChildren)
    snippet = snippet.replace(/(>)[\s\S]*(<\/[A-Z]\w*>)/, (_match, start: string, end: string) => `${start}\n\n${selected}\n\n${end}`)
  componentOpen.value = false
  run(view => insertBlock(view, snippet))
}
function addCode(language: string) {
  codeOpen.value = false
  run(view => insertCodeFence(view, language))
}
</script>

<template>
  <div class="writing-toolbar" aria-label="写作快捷操作">
    <div class="toolbar-row format-row" role="group" aria-label="快捷格式">
      <div class="tool-group">
        <button class="tool-icon" title="撤销 · Ctrl+Z" aria-label="撤销" :disabled="!editor.editor || (workspace.enabled && !workspace.canUndo && !workspace.pending)" @pointerdown.prevent @click="editor.undo()">
          <Undo2 />
        </button>
        <button class="tool-icon" title="重做 · Ctrl+Shift+Z" aria-label="重做" :disabled="!editor.editor || (workspace.enabled && (!workspace.canRedo || workspace.pending))" @pointerdown.prevent @click="editor.redo()">
          <Redo2 />
        </button>
      </div>
      <span class="tool-divider" />
      <select class="toolbar-select heading-select" aria-label="段落格式" value="" :disabled="!editor.editor" @change="headingChanged">
        <option value="" disabled>
          段落 / 标题
        </option><option value="0">
          正文
        </option><option v-for="n in 6" :key="n" :value="n">
          H{{ n }} 标题
        </option>
      </select>
      <button class="tool-icon" aria-label="首行不缩进" :title="noIndent ? '恢复主题默认首行缩进' : '取消当前或所选段落的首行缩进'" :aria-pressed="noIndent" :disabled="!editor.editor || !canAdjustIndent" @pointerdown.prevent @click="run(toggleParagraphIndent)">
        <IndentDecrease />
      </button>
      <div class="tool-group">
        <button v-for="tool in tools" :key="tool.label" class="tool-icon" :title="tool.hint" :aria-label="tool.label" :disabled="!editor.editor" @pointerdown.prevent @click="run(tool.run)">
          <component :is="tool.icon" />
        </button>
      </div>
      <span class="tool-divider" />
      <Popover v-model:open="codeOpen">
        <PopoverTrigger as-child>
          <button class="tool-text" :disabled="!editor.editor" aria-label="代码块" title="插入代码块">
            <CodeXml /><span>代码块</span><ChevronDown class="chevron" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" class="w-48 p-2" @close-auto-focus.prevent>
          <button v-for="language in ['python', 'sql', 'javascript', 'json', 'bash', '']" :key="language" class="code-choice" @click="addCode(language)">
            {{ language || '纯文本' }}
          </button>
        </PopoverContent>
      </Popover>
      <button class="tool-text" title="插入表格" @click="ui.openTableEditDialog()">
        <Table /><span>表格</span>
      </button>
      <button class="tool-text" :title="materialLibraryEnabled ? '素材库' : '插入图片'" @click="ui.isShowUploadImgDialog = true">
        <Image /><span>{{ materialLibraryEnabled ? '素材库' : '图片' }}</span>
      </button>
      <span class="tool-divider" />
      <Popover v-model:open="componentOpen">
        <PopoverTrigger as-child>
          <button class="tool-text component-trigger" :disabled="!editor.editor">
            <Blocks /><span>插入组件</span><ChevronDown class="chevron" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" class="w-[min(520px,94vw)] p-0 overflow-hidden" @close-auto-focus.prevent>
          <div class="component-search">
            <Search class="size-4 text-muted-foreground" /><input v-model="query" aria-label="搜索文章组件" placeholder="搜索导读、结论、指标卡…">
          </div>
          <div class="component-list component-grid">
            <button v-for="item in filteredComponents" :key="item.id" class="component-choice" @click="addComponent(item)">
              <ComponentThumbnail :component="item" /><span class="component-card-caption"><strong>{{ labels[item.name] || item.name }}</strong><small>{{ item.description }}</small></span><span class="component-add">＋</span>
            </button>
            <p v-if="!filteredComponents.length" class="p-6 text-center text-sm text-muted-foreground">
              没有匹配的组件
            </p>
          </div>
          <button class="component-manage" @click="componentOpen = false; ui.isShowComponentDialog = true">
            管理自定义组件 →
          </button>
        </PopoverContent>
      </Popover>
    </div>
  </div>
</template>

<style scoped>
.writing-toolbar {
  flex-shrink: 0;
  background: hsl(var(--background));
  border-bottom: 1px solid hsl(var(--border));
  container: editor-tools / inline-size;
}
.toolbar-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  padding: 7px 12px;
}
.format-row {
  min-height: 45px;
}
.settings-row {
  min-height: 42px;
  border-top: 1px solid hsl(var(--border) / 0.5);
  background: hsl(var(--muted) / 0.28);
  gap: 8px;
}
.tool-group {
  display: flex;
  gap: 1px;
  flex-shrink: 0;
}
.tool-icon,
.tool-text {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  flex-shrink: 0;
  height: 28px;
  padding: 0;
  border: 1px solid transparent;
  color: hsl(var(--foreground) / 0.75);
  cursor: pointer;
}
.tool-icon {
  width: 27px;
}
.tool-text {
  padding: 0 6px;
  font-size: 12px;
  white-space: nowrap;
}
.tool-icon svg,
.tool-text svg {
  width: 14px;
  height: 14px;
}
.tool-icon:hover,
.tool-text:hover {
  background: hsl(var(--accent));
  border-color: hsl(var(--border));
}
.tool-icon[aria-pressed='true'] {
  background: hsl(var(--accent));
  border-color: #81a89b;
}
.format-row .tool-text:not(.component-trigger) span {
  display: none;
}
.tool-divider {
  height: 18px;
  width: 1px;
  background: hsl(var(--border));
  flex-shrink: 0;
  margin: 0 3px;
}
.toolbar-select {
  height: 28px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  padding: 0 5px;
  color: hsl(var(--foreground));
  font-size: 11px;
  max-width: 128px;
}
.heading-select {
  width: 91px;
  flex-shrink: 0;
}
.theme-select {
  width: 116px;
}
.code-select {
  width: 115px;
}
.quick-setting {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
  font-size: 10px;
  color: hsl(var(--muted-foreground));
  white-space: nowrap;
}
.mac-option {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: hsl(var(--muted-foreground));
  white-space: nowrap;
}
.mac-option input {
  accent-color: #246d5e;
}
.component-trigger {
  margin-left: auto;
  color: #246d5e;
  font-weight: 600;
  background: #edf5f1;
  border-color: #c8ded4;
  padding: 0 8px;
}
.dark .component-trigger {
  color: #9bcbb7;
  background: #243d30;
  border-color: #446453;
}
.chevron {
  width: 10px !important;
}
.code-choice {
  display: block;
  width: 100%;
  text-align: left;
  padding: 9px 12px;
  cursor: pointer;
  font-size: 13px;
}
.code-choice:hover {
  background: hsl(var(--accent));
}
.component-search {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 14px;
  border-bottom: 1px solid hsl(var(--border));
  background: hsl(var(--muted) / 0.35);
}
.component-search input {
  width: 100%;
  font-size: 12px;
  background: transparent;
  outline: none;
}
.component-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  padding: 10px;
  max-height: min(480px, 62vh);
  overflow: auto;
  background: hsl(var(--muted) / 0.25);
}
.component-choice {
  display: block;
  position: relative;
  min-width: 0;
  text-align: left;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  cursor: pointer;
  overflow: hidden;
}
.component-choice:hover {
  border-color: #458973;
  box-shadow: 0 2px 10px rgb(30 63 45 / 9%);
}
.component-card-caption {
  display: block;
  padding: 10px 25px 10px 10px;
}
.component-card-caption strong {
  display: block;
  font-size: 12px;
  color: hsl(var(--foreground));
  font-weight: 600;
}
.component-card-caption small {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin-top: 4px;
  font-size: 10px;
  line-height: 1.6;
  color: hsl(var(--muted-foreground));
  min-height: 32px;
}
.component-add {
  position: absolute;
  right: 10px;
  bottom: 44px;
  font-size: 15px;
  color: #246d5e;
}
.component-manage {
  display: block;
  width: 100%;
  text-align: center;
  border-top: 1px solid hsl(var(--border));
  padding: 11px;
  font-size: 11px;
  color: #246d5e;
  cursor: pointer;
}
button:focus-visible,
select:focus-visible,
input:focus-visible {
  outline: 2px solid #428b83;
  outline-offset: 2px;
}
button:disabled {
  opacity: 0.35;
  pointer-events: none;
}
@container editor-tools (max-width: 520px) {
  .toolbar-row {
    padding: 6px 8px;
    gap: 3px;
  }
  .settings-row {
    gap: 6px;
  }
  .quick-setting > span {
    display: none;
  }
  .theme-select {
    width: 108px;
  }
  .code-select {
    width: 106px;
  }
  .tool-group {
    gap: 0;
  }
  .component-trigger {
    margin-left: 0;
  }
}
</style>
