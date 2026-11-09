<script setup lang="ts">
import { ARTICLE_COMPONENTS, ARTICLE_KIT_VERSION, ARTICLE_PRESETS, WECHAT_REFERENCE_PRESET } from '@article-studio/article-kit'
import referenceExample from '@article-studio/article-kit/wechat-reference.md?raw'
import { Download, Loader2 } from '@lucide/vue'
import ComponentThumbnail from '@/components/editor/ComponentThumbnail.vue'
import { useEditorRefresh } from '@/composables/useEditorRefresh'
import { buildArticleArtifact } from '@/services/publish/article-artifact'
import { useEditorStore } from '@/stores/editor'
import { usePostStore } from '@/stores/post'
import { useThemeStore } from '@/stores/theme'
import { useUIStore } from '@/stores/ui'

const theme = useThemeStore()
const ui = useUIStore()
const editor = useEditorStore()
const { editorRefresh } = useEditorRefresh()
const open = ref(false)
const tab = ref(`preview`)
const busy = ref(false)
const error = ref(``)
const artifact = shallowRef<Awaited<ReturnType<typeof buildArticleArtifact>> | null>(null)
const deviceWidth = ref(`375px`)
const codeThemes = [`atom-one-dark`, `atom-one-light`, `monokai`, `github`, `vs2015`, `xcode`]

async function selectPreset(preset: typeof ARTICLE_PRESETS[number]) {
  await theme.applyArticlePreset(preset.id)
  editorRefresh({ force: true })
  artifact.value = null
}

async function createReferenceExample() {
  await selectPreset(ARTICLE_PRESETS.find(preset => preset.id === WECHAT_REFERENCE_PRESET)!)
  const posts = usePostStore()
  posts.addPost(`公众号楷体红 · 排版示例`)
  await nextTick()
  editor.importContent(referenceExample)
  editor.flushContentToPostStore()
  editorRefresh({ force: true })
  open.value = false
}

function updateCodeTheme(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  theme.codeBlockTheme = `/code-themes/${value}.min.css`
  editorRefresh({ force: true })
  artifact.value = null
}

function refreshCode() {
  editorRefresh({ force: true })
  artifact.value = null
}

function insertComponent(snippet: string) {
  editor.replaceSelection(`\n\n${snippet}\n\n`)
  editorRefresh({ force: true })
  open.value = false
}

async function refreshArtifact() {
  busy.value = true
  error.value = ``
  artifact.value = null
  try { artifact.value = await buildArticleArtifact() }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { busy.value = false }
}

function downloadArtifact() {
  if (!artifact.value)
    return
  const url = URL.createObjectURL(new Blob([artifact.value.document], { type: `text/html;charset=utf-8` }))
  const link = document.createElement(`a`)
  link.href = url
  link.download = `article-wechat.html`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

watch(tab, (value) => {
  if (value === `preview`)
    refreshArtifact()
})
watch(open, (value) => {
  if (value && tab.value === `preview`)
    refreshArtifact()
})
</script>

<template>
  <Dialog v-model:open="open">
    <DialogTrigger as-child>
      <Button variant="outline" class="h-9">
        成稿检查
      </Button>
    </DialogTrigger>
    <DialogContent class="!max-w-[1080px] !w-[94vw] h-[86vh] flex flex-col overflow-hidden">
      <DialogHeader>
        <DialogTitle>本地文章工作台 <span class="text-xs font-normal text-muted-foreground">Article Kit v{{ ARTICLE_KIT_VERSION }}</span></DialogTitle>
        <DialogDescription>固定写作规范，持续积累数据与技术文章。</DialogDescription>
      </DialogHeader>
      <div class="flex gap-2 border-b pb-3">
        <Button v-for="item in [{ id: 'themes', name: '主题与代码' }, { id: 'components', name: '固定组件' }, { id: 'preview', name: '公众号成稿' }]" :key="item.id" :variant="tab === item.id ? 'default' : 'ghost'" @click="tab = item.id">
          {{ item.name }}
        </Button>
      </div>
      <div v-if="tab === 'themes'" class="flex-1 overflow-auto space-y-6 p-1">
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <button v-for="preset in ARTICLE_PRESETS" :key="preset.id" class="studio-preset text-left rounded-xl border p-4 hover:shadow-md transition-shadow" :class="theme.articlePresetId === preset.id ? 'ring-2 ring-primary' : ''" @click="selectPreset(preset)">
            <div class="studio-paper" :style="{ '--sample-color': preset.color }">
              <small>DATA / CODE / INSIGHT</small>
              <strong>从数据到结论</strong>
              <b>01 方法与观察</b>
              <i /><i /><i class="short" />
              <pre :style="{ background: ['github', 'atom-one-light'].includes(preset.code) ? '#fafafa' : '#282c34', color: ['github', 'atom-one-light'].includes(preset.code) ? '#383a42' : '#a8c0e6' }">import pandas as pd<br>data.groupby("bin").mean()</pre>
            </div>
            <p class="font-semibold mt-4">
              {{ preset.name }} <span class="text-xs text-muted-foreground">v1</span>
            </p>
            <p class="text-xs text-muted-foreground mt-1 leading-5">
              {{ preset.description }}
            </p>
          </button>
        </div>
        <div v-if="theme.articlePresetId === WECHAT_REFERENCE_PRESET" class="rounded-xl border p-4 space-y-3">
          <p class="text-sm">
            原文同款：14px 楷体、深红章节装饰、浅粉引言、浅色代码与 Mac 圆点。可从固定组件插入报表图片，或选择「图片与标语」组合。
          </p>
          <Button variant="outline" @click="createReferenceExample">
            新建同款排版示例
          </Button>
          <p class="text-xs text-muted-foreground">
            示例会新增一篇文章。楷体取决于设备字体；正文和字号仍可在「样式」中微调。
          </p>
        </div>
        <div class="rounded-xl border p-5 space-y-4">
          <p class="font-medium">
            代码风格
          </p>
          <div class="flex flex-wrap items-center gap-5 text-sm">
            <label class="space-x-2">高亮主题
              <select class="rounded border bg-background px-3 py-2" aria-label="代码高亮主题" :value="theme.codeBlockTheme.split('/').pop()?.replace('.min.css', '')" @change="updateCodeTheme">
                <option v-for="code in codeThemes" :key="code" :value="code">{{ code }}</option>
              </select>
            </label>
            <label class="flex items-center gap-2"><input v-model="theme.isMacCodeBlock" type="checkbox" @change="refreshCode">Mac 风格标题栏</label>
            <label class="flex items-center gap-2"><input v-model="theme.isShowLineNumber" type="checkbox" @change="refreshCode">显示行号</label>
          </div>
          <p class="text-xs text-muted-foreground">
            代码配色随项目安装在本地。更多配色、字号、行距与标题样式可在右侧「样式」面板调整。
          </p>
        </div>
        <div class="flex flex-wrap gap-3">
          <Button variant="outline" @click="ui.isShowCssEditor = true; open = false">
            编辑自定义 CSS
          </Button>
          <Button variant="outline" @click="ui.isOpenRightSlider = true; open = false">
            打开完整样式设置
          </Button>
        </div>
        <p class="text-xs text-muted-foreground leading-6">
          共享模式下，文章排版设置会同步到其他设备。固定组件使用 v1 名称，样式在本地代码中维护；新增风格版本时可保留历史文章排版。主题卡展示版式示意，正文以实时预览为准。
        </p>
      </div>
      <div v-else-if="tab === 'components'" class="flex-1 overflow-auto grid sm:grid-cols-2 gap-4 content-start p-1">
        <div v-for="component in ARTICLE_COMPONENTS" :key="component.id" class="rounded-xl border p-5 space-y-3">
          <ComponentThumbnail :component="component" />
          <p class="font-semibold">
            {{ component.name }}
          </p>
          <p class="text-sm text-muted-foreground">
            {{ component.description }}
          </p>
          <pre class="text-xs bg-muted rounded-lg p-3 whitespace-pre-wrap break-all leading-6">{{ component.example }}</pre>
          <Button variant="outline" @click="insertComponent(component.example || '')">
            插入组件
          </Button>
        </div>
      </div>
      <div v-else class="flex-1 min-h-0 flex flex-col gap-3">
        <div class="flex flex-wrap items-center gap-3">
          <Button variant="outline" :disabled="busy" @click="refreshArtifact">
            <Loader2 v-if="busy" class="size-4 animate-spin mr-2" />重新生成成稿
          </Button>
          <select v-model="deviceWidth" aria-label="成稿预览宽度" class="rounded border bg-background px-3 py-2 text-sm">
            <option value="375px">
              手机 375px
            </option><option value="390px">
              手机 390px
            </option><option value="100%">
              桌面宽度
            </option>
          </select>
          <Button variant="outline" :disabled="!artifact || busy" @click="downloadArtifact">
            <Download class="size-4 mr-2" />导出成稿 HTML
          </Button>
        </div>
        <p class="text-xs text-muted-foreground">
          这里显示与复制及 COSE 草稿同步共用的内联 HTML。实际公众号可能改写标签，发送前仍需检查手机预览。
        </p>
        <p v-if="error" role="alert" class="text-sm text-red-600">
          {{ error }}
        </p>
        <div v-if="artifact?.warnings.length" class="text-xs rounded-lg bg-amber-50 text-amber-900 p-3 space-y-1">
          <p v-for="warning in artifact.warnings" :key="warning">
            {{ warning }}
          </p>
        </div>
        <div class="flex-1 min-h-0 bg-muted rounded-xl p-3 flex justify-center">
          <iframe v-if="artifact" title="公众号成稿预览" sandbox="" :srcdoc="artifact.document" :style="{ width: deviceWidth }" class="h-full max-w-full bg-white rounded shadow-sm ring-1 ring-border" />
          <p v-else class="text-sm text-muted-foreground p-8">
            {{ busy ? '正在准备文章样式与内容…' : '请重新生成成稿' }}
          </p>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>

<style scoped>
.studio-paper {
  padding: 22px 18px;
  background: #fff;
  border: 1px solid #edf0f4;
  border-radius: 6px;
  color: #334155;
  min-height: 220px;
}
.studio-paper small {
  font: 9px monospace;
  letter-spacing: 1px;
  color: #94a3b8;
}
.studio-paper strong {
  display: block;
  font-size: 18px;
  margin: 13px 0 20px;
}
.studio-paper b {
  display: block;
  font-size: 12px;
  color: var(--sample-color);
  border-bottom: 2px solid var(--sample-color);
  padding-bottom: 7px;
}
.studio-paper i {
  display: block;
  height: 5px;
  background: #e2e8f0;
  border-radius: 2px;
  margin: 11px 0;
}
.studio-paper .short {
  width: 67%;
}
.studio-paper pre {
  border-radius: 5px;
  font: 10px/1.9 Consolas, monospace;
  padding: 12px;
  margin-top: 18px;
  white-space: pre-wrap;
}
</style>
