<script setup lang="ts">
import type { HeadingLevel, HeadingStyleType } from '@md/shared/configs'
import type { Format } from 'vue-pick-colors'
import { ARTICLE_PRESETS } from '@article-studio/article-kit'
import { Check, X } from '@lucide/vue'
import PickColors from 'vue-pick-colors'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useEditorRefresh } from '@/composables/useEditorRefresh'
import { useLocalizedStyleOptions } from '@/composables/useLocalizedStyleOptions'
import { useConfirmStore } from '@/stores/confirm'
import { useCssEditorStore } from '@/stores/cssEditor'
import { useThemeStore } from '@/stores/theme'
import { useUIStore } from '@/stores/ui'

const { t } = useI18n()
const themeStore = useThemeStore()
const uiStore = useUIStore()
const cssEditorStore = useCssEditorStore()
const confirmStore = useConfirmStore()
const options = useLocalizedStyleOptions()
const { scheduleEditorRefresh, editorRefresh } = useEditorRefresh()
const { isMobile, isOpenRightSlider, isDark } = storeToRefs(uiStore)
const {
  theme,
  fontFamily,
  fontSize,
  lineHeight,
  blockSpacing,
  linkColor,
  blockquoteBackground,
  primaryColor,
  codeBlockTheme,
  legend,
  isMacCodeBlock,
  isShowLineNumber,
  isCiteStatus,
  isUseIndent,
  isUseJustify,
  isCountStatus,
} = storeToRefs(themeStore)
const activeTab = ref('typography')
const sections = [{ id: 'typography', label: '排版' }, { id: 'colors', label: '配色' }, { id: 'code', label: '代码' }, { id: 'more', label: '更多' }]
const currentPreset = computed(() => ARTICLE_PRESETS.find(preset => preset.id === themeStore.articlePresetId))
const fontLabel = computed(() => options.value.fontFamilyOptions.find(option => option.value === fontFamily.value)?.label ?? '自定义字体')
const lineHeights = computed(() => [...options.value.lineHeightOptions].sort((a, b) => Number(a.value) - Number(b.value)))
const colors = computed(() => {
  const all = [...ARTICLE_PRESETS.map(preset => ({ label: preset.name, value: preset.color })), ...options.value.colorOptions]
  return all.filter((option, index) => all.findIndex(item => item.value.toLowerCase() === option.value.toLowerCase()) === index)
})
const commonCodeNames = ['atom-one-light', 'atom-one-dark', 'github', 'monokai', 'vs2015', 'xcode']
const commonCodeThemes = computed(() => options.value.codeBlockThemeOptions.filter(option => commonCodeNames.includes(option.label)))
const otherCodeThemes = computed(() => options.value.codeBlockThemeOptions.filter(option => !commonCodeNames.includes(option.label)))
function withCurrent(items: { label: string, value: string }[], value: string) {
  return items.some(item => item.value === value) ? items : [{ label: `自定义（${value}）`, value }, ...items]
}
async function refreshStyle() {
  await themeStore.applyCurrentTheme()
  scheduleEditorRefresh()
}
async function articlePresetChanged(event: Event) {
  await themeStore.applyArticlePreset((event.target as HTMLSelectElement).value)
  editorRefresh({ force: true })
}
const selectedHeadingLevel = ref<HeadingLevel>('h2')
const selectedHeadingStyle = computed({
  get: () => themeStore.getHeadingStyle(selectedHeadingLevel.value),
  set: (value: HeadingStyleType) => {
    themeStore.setHeadingStyle(selectedHeadingLevel.value, value)
    if (value === 'custom') {
      uiStore.isShowCssEditor = true
      nextTick(() => setTimeout(() => cssEditorStore.scrollToHeading(selectedHeadingLevel.value), 100))
    }
    void refreshStyle()
  },
})
const colorInput = ref(primaryColor.value)
const colorError = ref('')
watch(primaryColor, (value) => { colorInput.value = value; colorError.value = '' })
function colorChanged(value: string) {
  primaryColor.value = value
  colorInput.value = value
  colorError.value = ''
  void refreshStyle()
}
function commitColor() {
  const value = colorInput.value.trim()
  if (!/^(?:#[\da-f]{3,4}|#[\da-f]{6}|#[\da-f]{8}|rgba?\([\d\s.,/]+\))$/i.test(value) || !CSS.supports('color', value)) {
    colorError.value = '请输入有效的 HEX 或 RGB 颜色，例如 #c00000。'
    return
  }
  colorChanged(value)
}
const pickColorsContainer = useTemplateRef<HTMLElement>('pickColorsContainer')
const colorFormat = ref<Format>('hex')
const colorFormats: Format[] = ['hex', 'rgb']
function resetStyleConfirm() {
  confirmStore.confirm({
    title: '恢复当前主题默认值',
    description: `将恢复「${currentPreset.value?.name ?? '当前主题'}」的默认排版，并清除自定义 CSS。`,
    onConfirm: async () => {
      const preset = themeStore.articlePresetId
      themeStore.resetStyle()
      cssEditorStore.resetCssConfig()
      await themeStore.applyArticlePreset(preset)
      editorRefresh({ force: true })
      toast.success(t('toast.styleReset'))
    },
  })
}
</script>

<template>
  <div v-if="isMobile && isOpenRightSlider" class="fixed inset-0 bg-black/50 z-40" @click="isOpenRightSlider = false" />
  <aside v-show="!isMobile || isOpenRightSlider" aria-label="文章样式设置" class="style-settings flex h-full min-w-0 flex-col overflow-hidden bg-background" :class="{ 'fixed inset-y-0 right-0 z-55 w-full border-l shadow-lg': isMobile }">
    <header class="flex shrink-0 items-center justify-between border-b px-4 py-3">
      <div>
        <h2 class="text-sm font-semibold">
          样式设置
        </h2>
        <p class="mt-1 text-xs text-muted-foreground">
          {{ fontLabel }} · {{ fontSize }} · {{ lineHeight }} 倍行距
        </p>
      </div>
      <Button variant="ghost" size="icon" class="size-7" aria-label="关闭样式设置" @click="isOpenRightSlider = false">
        <X class="size-4" />
      </Button>
    </header>
    <div class="shrink-0 space-y-2 px-4 py-3">
      <label for="article-preset" class="text-xs font-medium">文章主题</label>
      <select id="article-preset" class="style-select" :value="themeStore.articlePresetId" @change="articlePresetChanged">
        <option v-for="preset in ARTICLE_PRESETS" :key="preset.id" :value="preset.id">
          {{ preset.name }}
        </option>
      </select>
      <p class="text-xs leading-5 text-muted-foreground">
        切换主题会一并应用字体、字号和代码配色。
      </p>
    </div>
    <Tabs v-model="activeTab" class="flex min-h-0 flex-1 flex-col">
      <TabsList class="mx-4 grid h-9 shrink-0 grid-cols-4" aria-label="样式分类">
        <TabsTrigger v-for="section in sections" :key="section.id" :value="section.id" class="text-xs">
          {{ section.label }}
        </TabsTrigger>
      </TabsList>
      <div class="style-settings-body min-h-0 flex-1 overflow-y-auto px-4 pb-5 pt-3">
        <TabsContent value="typography" class="mt-0 space-y-5">
          <div class="space-y-3">
            <label class="style-field"><span>{{ t('menu.font') }}</span>
              <select v-model="fontFamily" class="style-select" @change="refreshStyle"><option v-for="option in withCurrent(options.fontFamilyOptions, fontFamily)" :key="option.value" :value="option.value">{{ option.label }}</option></select>
            </label>
            <div class="grid grid-cols-2 gap-3">
              <label class="style-field"><span>{{ t('menu.fontSize') }}</span>
                <select v-model="fontSize" class="style-select" @change="refreshStyle"><option v-for="option in withCurrent(options.fontSizeOptions, fontSize)" :key="option.value" :value="option.value">{{ option.label }}</option></select>
              </label>
              <label class="style-field"><span>{{ t('menu.lineHeight') }}</span>
                <select v-model="lineHeight" class="style-select" @change="refreshStyle"><option v-for="option in withCurrent(lineHeights, lineHeight)" :key="option.value" :value="option.value">{{ option.label }}</option></select>
              </label>
            </div>
            <label class="style-field"><span>{{ t('menu.blockSpacing') }}</span>
              <select v-model="blockSpacing" class="style-select" @change="refreshStyle"><option v-for="option in withCurrent(options.blockSpacingOptions, blockSpacing)" :key="option.value" :value="option.value">{{ option.label }}</option></select>
            </label>
          </div>
          <div class="space-y-3 border-t pt-4">
            <div class="style-switch">
              <Label for="use-indent">{{ t('rightSlider.paragraphIndent') }}</Label><Switch id="use-indent" v-model="isUseIndent" @update:model-value="refreshStyle" />
            </div>
            <div class="style-switch">
              <Label for="use-justify">{{ t('rightSlider.paragraphJustify') }}</Label><Switch id="use-justify" v-model="isUseJustify" @update:model-value="refreshStyle" />
            </div>
          </div>
          <div class="space-y-2 border-t pt-4">
            <h3 class="text-xs font-medium">
              {{ t('rightSlider.headingStyle') }}
            </h3>
            <div class="grid grid-cols-[72px_minmax(0,1fr)] gap-3">
              <select v-model="selectedHeadingLevel" class="style-select" aria-label="标题级别">
                <option v-for="option in options.headingLevelOptions" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
              <select v-model="selectedHeadingStyle" class="style-select" aria-label="标题样式">
                <option v-for="option in options.headingStyleOptions" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
            </div>
          </div>
        </TabsContent>
        <TabsContent value="colors" class="mt-0 space-y-5">
          <div class="space-y-3">
            <h3 class="text-xs font-medium">
              {{ t('menu.primaryColor') }}
            </h3>
            <div class="grid grid-cols-6 gap-2" role="group" aria-label="常用主色">
              <button v-for="color in colors" :key="color.value" class="color-swatch" :style="{ background: color.value }" :aria-label="color.label" :title="`${color.label} · ${color.value}`" :aria-pressed="primaryColor.toLowerCase() === color.value.toLowerCase()" @click="colorChanged(color.value)">
                <Check v-if="primaryColor.toLowerCase() === color.value.toLowerCase()" class="size-4 text-white drop-shadow" />
              </button>
            </div>
            <label for="custom-primary-color" class="block text-xs">{{ t('menu.customPrimaryColor') }}</label>
            <div class="flex items-center gap-3">
              <div ref="pickColorsContainer" class="shrink-0">
                <PickColors v-if="pickColorsContainer" :value="primaryColor" show-alpha :format="colorFormat" :format-options="colorFormats" :theme="isDark ? 'dark' : 'light'" :popup-container="pickColorsContainer" @change="colorChanged" />
              </div>
              <input id="custom-primary-color" v-model="colorInput" class="style-select min-w-0 font-mono" spellcheck="false" :aria-invalid="Boolean(colorError)" :aria-describedby="colorError ? 'primary-color-error' : undefined" @change="commitColor" @keydown.enter.prevent="commitColor">
            </div>
            <p v-if="colorError" id="primary-color-error" class="text-xs text-destructive" role="alert">
              {{ colorError }}
            </p>
            <p class="text-xs leading-5 text-muted-foreground">
              滚动条、代码阴影与组件配色跟随主色。
            </p>
          </div>
          <div class="space-y-3 border-t pt-4">
            <label class="style-field"><span>{{ t('menu.linkColor') }}</span>
              <select v-model="linkColor" class="style-select" @change="refreshStyle"><option v-for="option in withCurrent(options.linkColorOptions, linkColor)" :key="option.value" :value="option.value">{{ option.label }}</option></select>
            </label>
            <label class="style-field"><span>{{ t('menu.blockquoteBackground') }}</span>
              <select v-model="blockquoteBackground" class="style-select" @change="refreshStyle"><option v-for="option in withCurrent(options.blockquoteBackgroundOptions, blockquoteBackground)" :key="option.value" :value="option.value">{{ option.label }}</option></select>
            </label>
          </div>
        </TabsContent>
        <TabsContent value="code" class="mt-0 space-y-5">
          <label class="style-field"><span>{{ t('menu.codeBlockTheme') }}</span>
            <select v-model="codeBlockTheme" class="style-select" @change="scheduleEditorRefresh">
              <optgroup label="常用配色"><option v-for="option in commonCodeThemes" :key="option.value" :value="option.value">{{ option.label }}</option></optgroup>
              <optgroup label="全部配色"><option v-for="option in otherCodeThemes" :key="option.value" :value="option.value">{{ option.label }}</option></optgroup>
            </select>
          </label>
          <div class="space-y-3 border-t pt-4">
            <div class="style-switch">
              <Label for="mac-code-block">{{ t('menu.macCodeBlock') }}</Label><Switch id="mac-code-block" v-model="isMacCodeBlock" @update:model-value="scheduleEditorRefresh" />
            </div>
            <div class="style-switch">
              <Label for="show-line-number">{{ t('rightSlider.codeBlockLineNumber') }}</Label><Switch id="show-line-number" v-model="isShowLineNumber" @update:model-value="scheduleEditorRefresh" />
            </div>
          </div>
        </TabsContent>
        <TabsContent value="more" class="mt-0 space-y-5">
          <div class="space-y-2">
            <label class="style-field"><span>基础版式</span>
              <select v-model="theme" class="style-select" @change="refreshStyle"><option v-for="option in options.themeOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select>
            </label>
            <Button variant="ghost" size="sm" class="h-7 px-0 text-xs text-muted-foreground" @click="uiStore.openMarketplaceDialog({ tab: 'theme', view: 'discover' })">
              {{ t('marketplace.exploreThemes') }}
            </Button>
          </div>
          <label class="style-field border-t pt-4"><span>{{ t('menu.legendFormat') }}</span>
            <select v-model="legend" class="style-select" @change="scheduleEditorRefresh"><option v-for="option in options.legendOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select>
          </label>
          <div class="space-y-3">
            <div class="style-switch">
              <Label for="cite-status">{{ t('rightSlider.citeStatus') }}</Label><Switch id="cite-status" v-model="isCiteStatus" @update:model-value="scheduleEditorRefresh" />
            </div>
            <div class="style-switch">
              <Label for="count-status">{{ t('rightSlider.wordCount') }}</Label><Switch id="count-status" v-model="isCountStatus" @update:model-value="scheduleEditorRefresh" />
            </div>
          </div>
          <div class="space-y-3 border-t pt-4">
            <Button variant="outline" class="w-full text-xs" @click="uiStore.isShowCssEditor = true">
              编辑 CSS
            </Button>
            <Button variant="ghost" class="w-full text-xs text-muted-foreground" @click="resetStyleConfirm">
              恢复当前主题默认值
            </Button>
          </div>
        </TabsContent>
      </div>
    </Tabs>
  </aside>
</template>

<style scoped>
.style-field {
  display: grid;
  gap: 6px;
  min-width: 0;
  font-size: 12px;
}
.style-select {
  display: block;
  width: 100%;
  height: 34px;
  padding: 0 9px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  font-size: 12px;
}
.style-select:focus-visible,
.color-swatch:focus-visible {
  outline: 2px solid hsl(var(--ring));
  outline-offset: 2px;
}
.style-switch {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 28px;
}
.style-switch label {
  font-size: 12px;
  line-height: 1.5;
}
.style-switch button {
  flex-shrink: 0;
}
.color-swatch {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 28px;
  border: 1px solid rgb(0 0 0 / 12%);
}
.color-swatch[aria-pressed='true'] {
  outline: 2px solid hsl(var(--foreground));
  outline-offset: 2px;
}
.style-settings-body {
  scrollbar-width: thin;
  scrollbar-color: var(--studio-scrollbar-thumb, #7b9bad) transparent;
}
</style>
