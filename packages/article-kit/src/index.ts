import type { CustomComponentDef } from '@md/shared/types'
import { WECHAT_REFERENCE_COMPONENTS } from './wechat-reference'

export { applyComponentTheme, componentPalette, type ComponentTheme, DEFAULT_COMPONENT_THEME } from './component-theme'

export { decorateWeChatReference, WECHAT_REFERENCE_FONT, WECHAT_REFERENCE_PRESET, WECHAT_REFERENCE_SOURCE } from './wechat-reference'

export const ARTICLE_KIT_VERSION = `1.1.0`

export const ARTICLE_PRESETS = [
  { id: `data-blue-v1`, name: `数据蓝`, description: `数据分析、指标解读与分箱实战`, color: `#245b83`, theme: `default`, code: `atom-one-dark` },
  { id: `research-green-v1`, name: `研究绿`, description: `方法推导、实验记录与研究笔记`, color: `#28756b`, theme: `grace`, code: `github` },
  { id: `technical-ink-v1`, name: `技术墨`, description: `Python / SQL 教程与工程实践`, color: `#394558`, theme: `simple`, code: `vs2015` },
  { id: `wechat-kaiti-red-v1`, name: `公众号·楷体红`, description: `参考文章：深红章节、楷体正文与浅色代码`, color: `#c00000`, theme: `default`, code: `atom-one-light` },
] as const

export type ArticlePresetId = typeof ARTICLE_PRESETS[number][`id`]

const box = `margin:24px 0;padding:18px 20px;border:1px solid #dce4ed;border-radius:6px;background:#f6f8fb;box-sizing:border-box;`
const heading = `margin:0 0 10px;font-size:14px;font-weight:700;line-height:1.6;color:#245b83;`

export const ARTICLE_COMPONENTS: CustomComponentDef[] = [
  ...WECHAT_REFERENCE_COMPONENTS,
  {
    id: `article-lead-v1`,
    name: `ArticleLeadV1`,
    builtIn: true,
    markdownChildren: true,
    description: `导读：统一文章范围、阅读目标与受众`,
    props: [{ name: `series`, description: `栏目名称`, default: `数据与代码` }],
    template: `<section style="${box}border-top:3px solid #245b83;"><p style="${heading}letter-spacing:1px;">{{series}}</p><section style="color:#475569;font-size:15px;line-height:1.8;">{{children}}</section></section>`,
    example: `<ArticleLeadV1 series="数据分析实战">\n\n用清晰的指标口径和可复现代码，解释数据背后的变化。\n\n</ArticleLeadV1>`,
  },
  {
    id: `article-finding-v1`,
    name: `KeyFindingV1`,
    builtIn: true,
    markdownChildren: true,
    description: `核心结论：先给观点，再给证据`,
    props: [{ name: `title`, description: `结论标题`, default: `核心结论` }],
    template: `<section style="${box}border-left:4px solid #245b83;"><p style="${heading}">{{title}}</p><section style="color:#263445;font-size:15px;line-height:1.8;">{{children}}</section></section>`,
    example: `<KeyFindingV1 title="核心结论">\n\n先交代结论，再说明样本、时间窗口和验证依据。\n\n</KeyFindingV1>`,
  },
  {
    id: `article-metric-v1`,
    name: `MetricCardV1`,
    builtIn: true,
    description: `指标卡：数值、单位与口径放在一起`,
    props: [
      { name: `label`, description: `指标名称`, required: true },
      { name: `value`, description: `指标值（含单位）`, required: true },
      { name: `detail`, description: `样本与统计口径`, default: `请注明统计口径` },
    ],
    template: `<section style="${box}background:#ffffff;"><p style="margin:0 0 6px;font-size:13px;color:#64748b;">{{label}}</p><p style="margin:0 0 8px;font-size:30px;font-weight:700;line-height:1.3;color:#245b83;">{{value}}</p><p style="margin:0;font-size:12px;line-height:1.6;color:#64748b;">{{detail}}</p></section>`,
    example: `<MetricCardV1 label="样本量" value="10,000 条" detail="演示数据；请替换为真实样本口径" />`,
  },
  {
    id: `article-method-v1`,
    name: `MethodNoteV1`,
    builtIn: true,
    markdownChildren: true,
    description: `方法说明：明确边界、假设与复现条件`,
    props: [{ name: `title`, description: `说明标题`, default: `方法与边界` }],
    template: `<section style="${box}background:#faf9f5;border-left:3px solid #b38a46;"><p style="${heading}color:#886324;">{{title}}</p><section style="color:#5c5140;font-size:14px;line-height:1.8;">{{children}}</section></section>`,
    example: `<MethodNoteV1 title="方法与边界">\n\n注明时间窗口、缺失值处理、训练验证切分与适用边界。\n\n</MethodNoteV1>`,
  },
  {
    id: `article-figure-v1`,
    name: `FigureCaptionV1`,
    builtIn: true,
    description: `图注：统一图序、说明与数据来源`,
    props: [
      { name: `number`, description: `图序`, default: `1` },
      { name: `caption`, description: `图表说明`, required: true },
      { name: `source`, description: `数据来源`, default: `作者整理` },
    ],
    template: `<section style="margin:8px 0 24px;text-align:center;"><p style="margin:0;font-size:13px;line-height:1.7;color:#64748b;">图 {{number}} · {{caption}}</p><p style="margin:2px 0 0;font-size:12px;line-height:1.6;color:#94a3b8;">数据来源：{{source}}</p></section>`,
    example: `<FigureCaptionV1 number="1" caption="各分箱样本分布" source="演示数据，作者整理" />`,
  },
  {
    id: `article-footer-v1`,
    name: `ArticleFooterV1`,
    builtIn: true,
    description: `文末信息：作者、环境与资料出处`,
    props: [
      { name: `author`, description: `作者`, default: `作者` },
      { name: `environment`, description: `复现环境`, default: `Python 3.11+ / pandas 2.x` },
      { name: `source`, description: `资料出处`, default: `请填写代码及数据来源` },
    ],
    template: `<section style="margin:36px 0 12px;padding-top:18px;border-top:1px solid #dce4ed;"><p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#475569;">{{author}} · 数据与代码</p><p style="margin:0;font-size:12px;line-height:1.8;color:#64748b;">复现环境：{{environment}}<br />资料：{{source}}</p></section>`,
    example: `<ArticleFooterV1 author="作者名" environment="Python 3.11 / pandas 2.x" source="填写代码仓库或资料链接" />`,
  },
]

export function isArticleComponent(name: string): boolean {
  return ARTICLE_COMPONENTS.some(component => component.name === name)
}

/** Versioned article components take precedence over browser-local overrides. */
export function mergeArticleComponents(base: CustomComponentDef[], user: CustomComponentDef[]): CustomComponentDef[] {
  const map = new Map(base.map(component => [component.name, component]))
  for (const component of user) {
    const existing = map.get(component.name)
    if (!isArticleComponent(component.name) && !existing?.hidden && !existing?.inline)
      map.set(component.name, component)
  }
  for (const component of ARTICLE_COMPONENTS)
    map.set(component.name, component)
  return [...map.values()]
}
