import type { HeadingLevel, HeadingStyles, HeadingStyleType, PerThemeSettings, PerThemeSettingsMap, ThemeName } from '@md/shared/configs'
import { ARTICLE_PRESETS, componentPalette, WECHAT_REFERENCE_FONT, WECHAT_REFERENCE_PRESET } from '@article-studio/article-kit'
import quoteCSS from '@article-studio/article-kit/blockquote.css?raw'
import codeCSS from '@article-studio/article-kit/code.css?raw'
import articleCSS from '@article-studio/article-kit/styles.css?raw'
import referenceCSS from '@article-studio/article-kit/wechat-reference.css?raw'
import { applyTheme } from '@md/core/theme'
import { defaultPerThemeSettings, defaultStyleConfig, widthOptions } from '@md/shared/configs'
import { isMarketplaceThemeKey } from '@md/shared/types'
import { store } from '@/storage'
import { addPrefix } from '@/storage/prefix'
import { useCssEditorStore } from '@/stores/cssEditor'

/**
 * Theme and style configuration.
 *
 * Each theme has its own settings (primaryColor, fontFamily, fontSize, lineHeight,
 * blockSpacing, linkColor, blockquoteBackground, codeBlockTheme, headingStyles,
 * isShowLineNumber, isMacCodeBlock); switching themes loads the matching config.
 */
export const useThemeStore = defineStore(`theme`, () => {
  const articlePresetId = store.reactive(`article-studio:preset`, `data-blue-v1`)
  const theme = store.reactive<ThemeName>(addPrefix(`theme`), defaultStyleConfig.theme)

  const themeSettings = store.reactive<PerThemeSettingsMap>(
    addPrefix(`themeSettings`),
    {},
  )

  const currentSettings = computed<PerThemeSettings>(() => {
    return themeSettings.value[theme.value] ?? defaultPerThemeSettings()
  })

  const primaryColor = computed<string>({
    get: () => currentSettings.value.primaryColor,
    set: (v: string) => { setThemeField(`primaryColor`, v) },
  })

  const fontFamily = computed<string>({
    get: () => currentSettings.value.fontFamily,
    set: (v: string) => { setThemeField(`fontFamily`, v) },
  })

  const fontSize = computed<string>({
    get: () => currentSettings.value.fontSize,
    set: (v: string) => { setThemeField(`fontSize`, v) },
  })

  // Settings persisted before these options existed have no value stored, so the
  // getters fall back to the default instead of leaving the picker unselected.
  const lineHeight = computed<string>({
    get: () => currentSettings.value.lineHeight ?? defaultStyleConfig.lineHeight,
    set: (v: string) => { setThemeField(`lineHeight`, v) },
  })

  const blockSpacing = computed<string>({
    get: () => currentSettings.value.blockSpacing ?? defaultStyleConfig.blockSpacing,
    set: (v: string) => { setThemeField(`blockSpacing`, v) },
  })

  const linkColor = computed<string>({
    get: () => currentSettings.value.linkColor ?? defaultStyleConfig.linkColor,
    set: (v: string) => { setThemeField(`linkColor`, v) },
  })

  const blockquoteBackground = computed<string>({
    get: () => currentSettings.value.blockquoteBackground ?? defaultStyleConfig.blockquoteBackground,
    set: (v: string) => { setThemeField(`blockquoteBackground`, v) },
  })

  const codeBlockTheme = computed<string>({
    get: () => currentSettings.value.codeBlockTheme,
    set: (v: string) => { setThemeField(`codeBlockTheme`, v) },
  })

  const headingStyles = computed<HeadingStyles>({
    get: () => currentSettings.value.headingStyles,
    set: (v: HeadingStyles) => { setThemeField(`headingStyles`, v) },
  })

  const isShowLineNumber = computed<boolean>({
    get: () => currentSettings.value.isShowLineNumber,
    set: (v: boolean) => { setThemeField(`isShowLineNumber`, v) },
  })

  const isMacCodeBlock = computed<boolean>({
    get: () => currentSettings.value.isMacCodeBlock,
    set: (v: boolean) => { setThemeField(`isMacCodeBlock`, v) },
  })

  function setThemeField<K extends keyof PerThemeSettings>(key: K, value: PerThemeSettings[K]) {
    const t = theme.value
    const existing = themeSettings.value[t] ?? defaultPerThemeSettings()
    themeSettings.value = {
      ...themeSettings.value,
      [t]: { ...existing, [key]: value },
    }
  }

  const isCiteStatus = store.reactive(`isCiteStatus`, defaultStyleConfig.isCiteStatus)
  const isCountStatus = store.reactive(`isCountStatus`, defaultStyleConfig.isCountStatus)
  const isUseIndent = store.reactive(addPrefix(`use_indent`), false)
  const isUseJustify = store.reactive(addPrefix(`use_justify`), false)
  const legend = store.reactive(`legend`, defaultStyleConfig.legend)
  const previewWidth = store.reactive(`previewWidth`, widthOptions[0].value)

  const fontSizeNumber = computed(() => Number(fontSize.value.replace(`px`, ``)))

  const toggleMacCodeBlock = useToggle(isMacCodeBlock)
  const toggleShowLineNumber = useToggle(isShowLineNumber)
  const toggleCiteStatus = useToggle(isCiteStatus)
  const toggleCountStatus = useToggle(isCountStatus)
  const toggleUseIndent = useToggle(isUseIndent)
  const toggleUseJustify = useToggle(isUseJustify)

  const resetStyle = () => {
    themeSettings.value = {
      ...themeSettings.value,
      [theme.value]: defaultPerThemeSettings(),
    }
    isCiteStatus.value = defaultStyleConfig.isCiteStatus
    isCountStatus.value = defaultStyleConfig.isCountStatus
    legend.value = defaultStyleConfig.legend
    isUseIndent.value = false
    isUseJustify.value = false
  }

  const setHeadingStyle = (level: HeadingLevel, style: HeadingStyleType) => {
    const existing = headingStyles.value
    headingStyles.value = {
      ...existing,
      [level]: style === `default` ? undefined : style,
    }
  }

  const getHeadingStyle = (level: HeadingLevel): HeadingStyleType => {
    return headingStyles.value[level] || `default`
  }

  const updateCodeTheme = () => {
    const cssUrl = codeBlockTheme.value
    const el = document.querySelector(`#hljs`)

    if (el) {
      if (el.getAttribute(`href`) === cssUrl)
        return
      el.setAttribute(`href`, cssUrl)
    }
    else {
      const link = document.createElement(`link`)
      link.setAttribute(`type`, `text/css`)
      link.setAttribute(`rel`, `stylesheet`)
      link.setAttribute(`href`, cssUrl)
      link.setAttribute(`id`, `hljs`)
      document.head.appendChild(link)
    }
  }

  const applyCurrentTheme = async () => {
    try {
      const cssEditorStore = useCssEditorStore()
      const customCSS = cssEditorStore.getCurrentTabContent()
      const palette = componentPalette({ primaryColor: primaryColor.value, fontFamily: fontFamily.value, fontSize: fontSize.value, lineHeight: lineHeight.value })
      const quoteBackground = blockquoteBackground.value === `default` || blockquoteBackground.value.includes(`color-mix`)
        ? palette.quoteTint
        : blockquoteBackground.value

      // Lazy import avoids Pinia circular init with marketplace store
      let themeCSS: string | undefined
      if (isMarketplaceThemeKey(theme.value)) {
        const { useMarketplaceStore } = await import(`@/stores/marketplace`)
        themeCSS = useMarketplaceStore().getInstalledThemeCss(theme.value)
      }

      await applyTheme({
        themeName: theme.value,
        themeCSS,
        customCSS: `${articlePresetId.value === WECHAT_REFERENCE_PRESET ? referenceCSS : articleCSS}
:root {
  --md-quote-tint: ${quoteBackground};
  --md-code-shadow: ${palette.codeShadow};
  --studio-scrollbar-thumb: ${palette.scrollbarThumb};
  --studio-scrollbar-hover: ${palette.scrollbarHover};
  --studio-scrollbar-track: ${palette.scrollbarTrack};
}
${quoteCSS}\n${codeCSS}\n${customCSS}`,
        variables: {
          primaryColor: primaryColor.value,
          fontFamily: fontFamily.value,
          fontSize: fontSize.value,
          lineHeight: lineHeight.value,
          blockSpacing: blockSpacing.value,
          linkColor: linkColor.value,
          blockquoteBackground: blockquoteBackground.value,
          isUseIndent: isUseIndent.value,
          isUseJustify: isUseJustify.value,
          headingStyles: headingStyles.value,
        },
      })
    }
    catch (error) {
      console.error(`[applyCurrentTheme] 主题应用失败:`, error)
    }
  }

  async function applyArticlePreset(id: string) {
    const preset = ARTICLE_PRESETS.find(item => item.id === id)
    if (!preset)
      return
    const reference = id === WECHAT_REFERENCE_PRESET
    articlePresetId.value = id
    theme.value = preset.theme
    primaryColor.value = preset.color
    fontFamily.value = reference ? WECHAT_REFERENCE_FONT : defaultStyleConfig.fontFamily
    fontSize.value = reference ? `14px` : `16px`
    lineHeight.value = reference ? `1.6` : `1.75`
    headingStyles.value = {}
    codeBlockTheme.value = `/code-themes/${preset.code}.min.css`
    isMacCodeBlock.value = true
    isShowLineNumber.value = false
    await applyCurrentTheme()
    updateCodeTheme()
  }

  return {
    theme,
    articlePresetId,
    themeSettings,
    fontFamily,
    fontSize,
    fontSizeNumber,
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
    isCountStatus,
    isUseIndent,
    isUseJustify,
    previewWidth,
    headingStyles,
    toggleMacCodeBlock,
    toggleShowLineNumber,
    toggleCiteStatus,
    toggleCountStatus,
    toggleUseIndent,
    toggleUseJustify,
    resetStyle,
    updateCodeTheme,
    applyCurrentTheme,
    applyArticlePreset,
    setHeadingStyle,
    getHeadingStyle,
  }
})
