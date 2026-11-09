<script setup lang="ts">
import type { Post, PostAccount } from '@md/shared/types'
import type { PublishDraftMap } from '@/services/publish/drafts'
import type { CoseAddTaskData } from '@/types/cose'
import { Check, ChevronDown, ChevronRight, Info, Loader2, Minus } from '@lucide/vue'
import { CheckboxIndicator, CheckboxRoot, Primitive } from 'reka-ui'
import { buildArticleArtifact } from '@/services/publish/article-artifact'
import { createPublishDraftSession, PUBLISH_DRAFTS_KEY } from '@/services/publish/drafts'
import { buildPublishTasks } from '@/services/publish/tasks'
import { store } from '@/storage'
import { usePostStore } from '@/stores/post'
import { useUIStore } from '@/stores/ui'
import PublishImageField from './PublishImageField.vue'

defineOptions({
  inheritAttrs: false,
})

const { t } = useI18n()

const preparing = ref(false)
const preparationError = ref(``)

const uiStore = useUIStore()
const { isMobile } = storeToRefs(uiStore)

const dialogVisible = ref(false)
const thumbPreviewVisible = ref(false)
const extensionInstalled = ref(false)
const allAccounts = ref<PostAccount[]>([])
const postTaskDialogVisible = ref(false)
const postRunning = ref(false)
const isCheckingLogin = ref(false)
const imageBusy = ref(false)
const submittedTasks = shallowRef<CoseAddTaskData[]>([])
const posts = usePostStore()
const drafts = createPublishDraftSession(store.reactive<PublishDraftMap>(PUBLISH_DRAFTS_KEY, {}))
const { fields: publishFields, active: activeChannel, articleId: draftArticleId } = drafts
const selectedAccounts = computed(() => allAccounts.value.filter(account => account.checked))
let preparationGeneration = 0
let artifactQueue = Promise.resolve()

function prepareArtifact() {
  const result = artifactQueue.then(() => buildArticleArtifact())
  artifactQueue = result.then(() => {}, () => {})
  return result
}

const form = ref<Post>({
  title: ``,
  desc: ``,
  thumb: ``,
  content: ``,
  markdown: ``,
  accounts: [] as PostAccount[],
})

const allowPost = computed(() => !preparing.value && !imageBusy.value && !postRunning.value && !!form.value.content && extensionInstalled.value && allAccounts.value.some(a => a.checked && a.loggedIn))

const platformCategories = [
  {
    id: `media`,
    platforms: [`wechat`, `toutiao`, `zhihu`, `baijiahao`, `wangyihao`, `sohu`, `weibo`, `bilibili`, `sspai`, `twitter`, `douyin`, `xiaohongshu`, `douban`],
  },
  {
    id: `blog`,
    platforms: [`csdn`, `cnblogs`, `juejin`, `medium`, `cto51`, `segmentfault`, `oschina`, `infoq`, `jianshu`],
  },
  {
    id: `cloud`,
    platforms: [`tencentcloud`, `aliyun`, `huaweicloud`, `huaweidev`, `qianfan`, `alipayopen`, `modelscope`, `volcengine`, `elecfans`],
  },
]

// Category collapse state (cloud/dev collapsed by default)
const collapsedCategories = ref<Set<string>>(new Set([`cloud`]))

function toggleCategory(categoryName: string) {
  if (collapsedCategories.value.has(categoryName)) {
    collapsedCategories.value.delete(categoryName)
  }
  else {
    collapsedCategories.value.add(categoryName)
  }
}

const accountsByCategory = computed(() => {
  return platformCategories.map(category => ({
    id: category.id,
    name: t(`postInfo.categories.${category.id}`),
    accounts: category.platforms
      .map(type => allAccounts.value.find(a => a.type === type))
      .filter((a): a is PostAccount => a !== undefined),
  }))
})

// Whether category is fully selected (logged-in only)
function isCategoryAllSelected(accounts: PostAccount[]) {
  const loggedInAccounts = accounts.filter(a => a.loggedIn)
  return loggedInAccounts.length > 0 && loggedInAccounts.every(a => a.checked)
}

function isCategoryIndeterminate(accounts: PostAccount[]) {
  const loggedInAccounts = accounts.filter(a => a.loggedIn)
  const checkedCount = loggedInAccounts.filter(a => a.checked).length
  return checkedCount > 0 && checkedCount < loggedInAccounts.length
}

function toggleCategorySelectAll(accounts: PostAccount[]) {
  const loggedInAccounts = accounts.filter(a => a.loggedIn)
  const allSelected = loggedInAccounts.every(a => a.checked)
  loggedInAccounts.forEach(a => a.checked = !allSelected)
}

async function prePost() {
  const generation = ++preparationGeneration
  const articleId = posts.currentPostId
  preparing.value = true
  preparationError.value = ``
  form.value.content = ``
  // Start detection when extension installed but no account data
  if (extensionInstalled.value && allAccounts.value.length === 0) {
    // Fire-and-forget; detection runs in background
    startLoginDetection()
  }

  try {
    const artifact = await prepareArtifact()
    if (generation !== preparationGeneration || articleId !== posts.currentPostId || !dialogVisible.value)
      return
    form.value = {
      thumb: document.querySelector<HTMLImageElement>(`#output img`)?.getAttribute(`src`) ?? ``,
      title: [1, 2, 3, 4, 5, 6]
        .map(h => document.querySelector(`#output h${h}`))
        .find(h => h)
        ?.textContent ?? ``,
      desc: document.querySelector(`#output p`)?.textContent?.trim() ?? ``,
      content: artifact.html,
      markdown: artifact.markdown,
      accounts: [],
    }
    drafts.open(articleId, form.value)
    allAccounts.value.forEach((account) => { account.checked = drafts.selected.value.includes(account.type) })
  }
  catch (cause) {
    if (generation === preparationGeneration)
      preparationError.value = cause instanceof Error ? cause.message : String(cause)
  }
  finally {
    if (generation === preparationGeneration)
      preparing.value = false
  }
}

watch(dialogVisible, (newVal) => {
  if (newVal) {
    prePost()
  }
  else {
    preparationGeneration++
    preparing.value = false
  }
})

watch(() => posts.currentPostId, () => {
  if (dialogVisible.value)
    void prePost()
})
watch(() => selectedAccounts.value.map(account => account.type), (types) => {
  if (dialogVisible.value && !preparing.value && form.value.content)
    drafts.select(types)
})

function getInitialPlatforms(): PostAccount[] {
  if (typeof window.$cose?.getPlatforms === `function`) {
    return window.$cose.getPlatforms().map(platform => ({
      ...platform,
      checked: drafts.selected.value.includes(platform.type),
      loggedIn: false,
      isChecking: true,
    }))
  }
  return []
}

// Async login check with progressive UI updates
function startLoginDetection() {
  const cose = window.$cose
  if (!cose)
    return

  const initialPlatforms = getInitialPlatforms()
  if (initialPlatforms.length > 0) {
    allAccounts.value = initialPlatforms
  }

  isCheckingLogin.value = true
  let hasReceivedAny = false

  // Stop detection after 15s with no response
  const LOGIN_CHECK_TIMEOUT_MS = 15000
  const timeoutId = setTimeout(() => {
    if (!hasReceivedAny) {
      allAccounts.value = allAccounts.value.map(a => ({ ...a, isChecking: false }))
      isCheckingLogin.value = false
    }
  }, LOGIN_CHECK_TIMEOUT_MS)

  if (typeof cose.getAccountsProgressive === `function`) {
    cose.getAccountsProgressive(
      (account: PostAccount, _completed: number, _total: number) => {
        hasReceivedAny = true

        const idx = allAccounts.value.findIndex(a => a.type === account.type)
        if (idx !== -1) {
          allAccounts.value[idx] = { ...account, checked: drafts.selected.value.includes(account.type), isChecking: false }
        }
      },
      () => {
        clearTimeout(timeoutId)
        isCheckingLogin.value = false
      },
    )
  }
  else {
    cose.getAccounts?.((resp: PostAccount[]) => {
      hasReceivedAny = true
      clearTimeout(timeoutId)
      allAccounts.value = resp.map(a => ({ ...a, checked: drafts.selected.value.includes(a.type), isChecking: false }))
      isCheckingLogin.value = false
    })
  }
}

// Legacy getAccounts for checkExtension
async function getAccounts(): Promise<void> {
  return new Promise((resolve) => {
    startLoginDetection()
    resolve()
  })
}

async function post() {
  if (!allowPost.value)
    return
  const articleId = posts.currentPostId
  const generation = ++preparationGeneration
  const accounts = allAccounts.value.filter(a => a.checked && a.loggedIn).map(account => ({ ...account }))
  const metadata = drafts.snapshot(accounts.map(account => account.type))
  preparing.value = true
  preparationError.value = ``
  try {
    const artifact = await prepareArtifact()
    const tasks = await buildPublishTasks(artifact, accounts, metadata)
    if (generation !== preparationGeneration || articleId !== posts.currentPostId || !dialogVisible.value)
      return
    submittedTasks.value = tasks
    postTaskDialogVisible.value = true
    dialogVisible.value = false
  }
  catch (cause) {
    if (generation === preparationGeneration)
      preparationError.value = cause instanceof Error ? cause.message : String(cause)
  }
  finally {
    if (generation === preparationGeneration)
      preparing.value = false
  }
}

function onUpdate(val: boolean) {
  if (!val) {
    dialogVisible.value = false
  }
}

function getPlatformUrl(type: string): string {
  const urls: Record<string, string> = {
    csdn: 'https://blog.csdn.net',
    juejin: 'https://juejin.cn',
    wechat: 'https://mp.weixin.qq.com',
    zhihu: 'https://www.zhihu.com/signin',
    toutiao: 'https://mp.toutiao.com',
    segmentfault: 'https://segmentfault.com/user/login',
    cnblogs: 'https://i.cnblogs.com/articles/edit',
    oschina: 'https://my.oschina.net/blog/write',
    cto51: 'https://blog.51cto.com/blogger/publish?&newBloger=2',
    infoq: 'https://xie.infoq.cn/draft/',
    jianshu: 'https://www.jianshu.com/sign_in',
    baijiahao: 'https://baijiahao.baidu.com',
    wangyihao: 'https://mp.163.com/subscribe_v4/index.html#/article-publish',
    tencentcloud: 'https://cloud.tencent.com/developer',
    medium: 'https://medium.com/m/signin',
    sspai: 'https://sspai.com/write',
    sohu: 'https://mp.sohu.com/mpfe/v4/login',
    bilibili: 'https://passport.bilibili.com/login',
    weibo: 'https://passport.weibo.com/sso/signin',
    aliyun: 'https://account.aliyun.com/login/login.htm',
    huaweicloud: 'https://bbs.huaweicloud.com/blogs/article',
    huaweidev: 'https://developer.huawei.com/consumer/cn/blog/create',
    twitter: 'https://x.com/compose/articles/edit/',
    qianfan: 'https://qianfan.cloud.baidu.com/qianfandev/topic/create',
    alipayopen: 'https://open.alipay.com/portal/forum/post/add#article',
    modelscope: 'https://modelscope.cn/learn/create',
    volcengine: 'https://developer.volcengine.com/articles/draft',
    douyin: 'https://creator.douyin.com/creator-micro/content/post/article?default-tab=5&enter_from=publish_page&media_type=article&type=new',
    xiaohongshu: 'https://creator.xiaohongshu.com/publish/publish?from=menu&target=article',
    elecfans: 'https://www.elecfans.com/d/article/md/',
    douban: 'https://www.douban.com/note/create',
  }
  return urls[type] || '#'
}

function onAvatarError(account: PostAccount, event: Event) {
  const img = event.target as HTMLImageElement
  if (!account)
    return
  img.style.display = 'none'
}

function checkExtension() {
  if (window.$cose !== undefined) {
    extensionInstalled.value = true
    getAccounts()
    return
  }

  // Poll every 500ms for 5s if extension not loaded
  const EXTENSION_CHECK_INTERVAL_MS = 500
  const MAX_EXTENSION_CHECKS = 10
  let count = 0
  const timer = setInterval(async () => {
    if (window.$cose !== undefined) {
      extensionInstalled.value = true
      await getAccounts()
      clearInterval(timer)
      return
    }

    count++
    if (count > MAX_EXTENSION_CHECKS) {
      clearInterval(timer)
    }
  }, EXTENSION_CHECK_INTERVAL_MS)
}

onBeforeMount(() => {
  checkExtension()
})
</script>

<template>
  <div v-bind="$attrs">
    <Dialog v-model:open="dialogVisible" @update:open="onUpdate">
      <DialogTrigger as-child>
        <Button v-if="!isMobile" variant="outline" class="h-9">
          {{ t('postInfo.publish') }}
        </Button>
      </DialogTrigger>
      <DialogContent class="!max-w-[95vw] !w-[min(750px,95vw)] max-h-[85vh] flex flex-col overflow-hidden">
        <p v-if="preparing" class="text-sm text-muted-foreground">
          正在生成内联样式成稿…
        </p>
        <p v-if="preparationError" role="alert" class="text-sm text-red-600">
          {{ preparationError }}
        </p>
        <DialogHeader>
          <DialogTitle>{{ t('postInfo.title') }}</DialogTitle>
          <DialogDescription class="text-left leading-relaxed">
            {{ t('postInfo.description') }}
          </DialogDescription>
        </DialogHeader>
        <div class="flex-1 overflow-y-auto p-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden flex flex-col gap-4">
          <Alert v-if="!extensionInstalled">
            <Info class="h-4 w-4" />
            <AlertTitle>{{ t('postInfo.extensionMissingTitle') }}</AlertTitle>
            <AlertDescription>
              <i18n-t keypath="postInfo.extensionMissingDescription" tag="span">
                <template #link>
                  <a href="https://chromewebstore.google.com/detail/ilhikcdphhpjofhlnbojifbihhfmmhfk" target="_blank" rel="noopener noreferrer" class="underline text-primary">{{ t('postInfo.extensionLinkText') }}</a>
                </template>
              </i18n-t>
            </AlertDescription>
          </Alert>

          <Alert>
            <Info class="h-4 w-4" />
            <AlertDescription>
              <i18n-t keypath="postInfo.coseHint" tag="span">
                <template #githubLink>
                  <a href="https://github.com/doocs/cose" target="_blank" rel="noopener noreferrer" class="underline">{{ t('postInfo.coseGithubText') }}</a>
                </template>
              </i18n-t>
              <br>
              <i18n-t keypath="postInfo.coseContribute" tag="span">
                <template #issueLink>
                  <a href="https://github.com/doocs/cose/issues" target="_blank" rel="noopener noreferrer" class="underline">{{ t('postInfo.issueLinkText') }}</a>
                </template>
              </i18n-t>
            </AlertDescription>
          </Alert>

          <div class="w-full flex flex-col gap-4" :class="{ 'pointer-events-none opacity-50': preparing || !form.content }" :inert="preparing || !form.content || undefined" :aria-disabled="preparing || !form.content">
            <div class="space-y-2 rounded-md border bg-muted/20 p-3">
              <Label for="publish-channel">当前编辑渠道</Label>
              <select id="publish-channel" :value="activeChannel" :disabled="imageBusy" class="h-9 w-full rounded-md border bg-background px-3 text-sm" @change="drafts.activate(($event.target as HTMLSelectElement).value)">
                <option value="">
                  通用设置（新选渠道的默认内容）
                </option>
                <option v-for="account in selectedAccounts" :key="account.type" :value="account.type">
                  {{ account.title }}
                </option>
              </select>
              <p class="text-xs text-muted-foreground">
                封面、标题和描述按文章及渠道自动保存在本机，重新打开会恢复。多选渠道后可分别编辑。
              </p>
            </div>
            <div class="grid grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(5.5rem,auto)_1fr] sm:gap-x-4">
              <Label for="thumb" class="sm:text-end">
                {{ t('postInfo.cover') }}
              </Label>
              <PublishImageField id="thumb" :key="`${draftArticleId}:${activeChannel}`" :model-value="publishFields.thumb" :placeholder="t('postInfo.coverPlaceholder')" @update:model-value="drafts.update({ thumb: $event })" @busy="imageBusy = $event">
                <Button v-if="publishFields.thumb" variant="outline" size="sm" class="shrink-0" @click="thumbPreviewVisible = true">
                  {{ t('common.view') }}
                </Button>
              </PublishImageField>
            </div>
            <div class="grid grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(5.5rem,auto)_1fr] sm:gap-x-4">
              <Label for="title" class="sm:text-end">
                {{ t('postInfo.titleLabel') }}
              </Label>
              <Input id="title" :model-value="publishFields.title" :placeholder="t('postInfo.titlePlaceholder')" class="min-w-0" @update:model-value="drafts.update({ title: String($event) })" />
            </div>
            <div class="grid grid-cols-1 items-start gap-2 sm:grid-cols-[minmax(5.5rem,auto)_1fr] sm:gap-x-4">
              <Label for="desc" class="sm:pt-2 sm:text-end">
                {{ t('postInfo.descLabel') }}
              </Label>
              <Textarea id="desc" :model-value="publishFields.desc" :placeholder="t('postInfo.descPlaceholder')" class="min-w-0" @update:model-value="drafts.update({ desc: String($event) })" />
            </div>

            <div class="grid grid-cols-1 items-start gap-2 sm:grid-cols-[minmax(5.5rem,auto)_1fr] sm:gap-x-4">
              <Label class="sm:pt-1 sm:text-end">
                {{ t('postInfo.platform') }}
              </Label>
              <div class="min-w-0 flex-1 space-y-3">
                <div v-for="category in accountsByCategory" :key="category.id">
                  <div class="flex items-center gap-2 mb-2">
                    <div
                      class="flex items-center gap-1 cursor-pointer select-none text-sm font-medium text-muted-foreground hover:text-foreground"
                      @click="toggleCategory(category.id)"
                    >
                      <ChevronDown v-if="!collapsedCategories.has(category.id)" class="h-4 w-4" />
                      <ChevronRight v-else class="h-4 w-4" />
                      <span>{{ category.name }}</span>
                      <span class="text-xs">({{ category.accounts.length }})</span>
                    </div>
                    <div class="flex items-center gap-1 ml-2">
                      <CheckboxRoot
                        :model-value="isCategoryAllSelected(category.accounts) ? true : isCategoryIndeterminate(category.accounts) ? 'indeterminate' : false"
                        :aria-label="`${category.name}全选`"
                        class="bg-background hover:bg-muted h-[18px] w-[18px] flex shrink-0 appearance-none items-center justify-center border border-gray-300 rounded-[3px] outline-hidden"
                        @click.stop="toggleCategorySelectAll(category.accounts)"
                      >
                        <CheckboxIndicator>
                          <Check v-if="isCategoryAllSelected(category.accounts)" class="h-3 w-3" />
                          <Minus v-else-if="isCategoryIndeterminate(category.accounts)" class="h-3 w-3" />
                        </CheckboxIndicator>
                      </CheckboxRoot>
                      <span class="text-xs text-muted-foreground">{{ t('common.selectAll') }}</span>
                    </div>
                  </div>
                  <div v-show="!collapsedCategories.has(category.id)" class="grid grid-cols-1 gap-x-6 gap-y-2 pl-5 sm:grid-cols-2">
                    <div
                      v-for="account in category.accounts"
                      :key="account.uid"
                      class="flex min-w-0 items-center gap-2"
                    >
                      <CheckboxRoot
                        v-model="account.checked"
                        :aria-label="account.title"
                        :disabled="!account.loggedIn"
                        class="bg-background hover:bg-muted h-[18px] w-[18px] flex shrink-0 appearance-none items-center justify-center border border-gray-300 rounded-[3px] outline-hidden disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <CheckboxIndicator>
                          <Check v-if="account.checked" class="h-3 w-3" />
                        </CheckboxIndicator>
                      </CheckboxRoot>
                      <img
                        :src="account.icon"
                        alt=""
                        class="inline-block h-[16px] w-[16px] shrink-0"
                      >
                      <span class="truncate text-sm font-medium">{{ account.title }}</span>
                      <template v-if="account.isChecking">
                        <Loader2 class="ml-1 h-3.5 w-3.5 animate-spin text-muted-foreground" />
                        <span class="text-xs text-muted-foreground">{{ t('postInfo.checking') }}</span>
                      </template>
                      <template v-else-if="account.loggedIn">
                        <img
                          v-if="account.avatar"
                          :src="account.avatar"
                          alt=""
                          class="ml-1 h-4 w-4 rounded-full object-cover"
                          @error="onAvatarError(account, $event)"
                        >
                        <span class="truncate text-sm text-muted-foreground">@{{ account.displayName }}</span>
                      </template>
                      <Primitive
                        v-else
                        as="a"
                        :href="getPlatformUrl(account.type)"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="ml-1 text-sm text-muted-foreground hover:underline"
                      >
                        {{ t('common.login') }}
                      </Primitive>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" @click="dialogVisible = false">
            {{ t('common.cancel') }}
          </Button>
          <Button :disabled="!allowPost" @click="post">
            {{ t('common.confirm') }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="thumbPreviewVisible">
      <DialogContent class="!max-w-[80vw] !w-fit">
        <p v-if="preparing" class="text-sm text-muted-foreground">
          正在生成内联样式成稿…
        </p>
        <p v-if="preparationError" role="alert" class="text-sm text-red-600">
          {{ preparationError }}
        </p>
        <DialogHeader>
          <DialogTitle>{{ t('postInfo.coverPreview') }}</DialogTitle>
        </DialogHeader>
        <div class="flex items-center justify-center p-2">
          <img
            :src="publishFields.thumb"
            :alt="t('postInfo.coverPreviewAlt')"
            class="max-h-[70vh] max-w-full rounded-md object-contain"
            @load="($event.target as HTMLImageElement).style.removeProperty('display')"
            @error="($event.target as HTMLImageElement).style.display = 'none'"
          >
        </div>
      </DialogContent>
    </Dialog>

    <PostTaskDialog v-model:open="postTaskDialogVisible" :tasks="submittedTasks" @busy="postRunning = $event" />
  </div>
</template>
