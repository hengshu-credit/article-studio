# Article Studio

本地运行的 Markdown 写作工作台，面向数据分析、Python / SQL 教程和技术文章。使用 **doocs/md 完整编辑器**，通过 **doocs/cose 浏览器扩展**分发文章，首要适配微信公众号。

## 本地启动

需要 Node.js >= 22.22.2、pnpm 11.25.0。开发地址固定为 **http://127.0.0.1:5173/**，日常使用请保持地址和端口一致。

```powershell
git clone https://github.com/hengshu-credit/article-studio.git
cd article-studio
pnpm install --frozen-lockfile
pnpm dev
```

Windows 用户也可以在仓库根目录运行 `./start.ps1`。

生产版本：`pnpm build`，再运行 `pnpm preview`，访问 http://127.0.0.1:4173/。不同地址的浏览器草稿相互独立，切换地址前请导出 Markdown。

## 写作与排版

正文编辑区上方仅保留一排格式和组件插入操作，不显示主题配置或文章标题信息条。主题、字号、代码配色与 Mac 标题栏统一在顶部「样式设置」打开的侧栏调整；CSS 编辑也在该面板中进入。组件缩略图、正文与成稿共享主题配色、字体和直角边框，切换主题后自动同步。视图切换集中在底部，复制、成稿检查与发布集中在顶部。

- 左侧管理本地文章，中间编辑 Markdown，右侧即时预览，支持滚动同步。
- **成稿检查 → 主题与代码**：数据蓝、研究绿、技术墨与公众号·楷体红四套本地方案；六种常用代码配色、Mac 标题栏、行号开关。
- **样式**：完整主题、主色、字体、字号、行距、标题、引用和更多代码配色。
- **成稿检查 → 编辑自定义 CSS**：保留 doocs/md 的 CSS 编辑与本地方案管理，可导出 CSS。
- **成稿检查 → 固定组件**：插入导读、核心结论、指标卡、方法说明、图注和文末信息，以及楷体红专用的引言、栏目短句、强调段和报告图片。
- **成稿检查 → 公众号成稿**：以 375px / 390px / 桌面宽度检查实际内联 HTML，也可下载该 HTML。
- **复制**与**文件 → 导出 HTML**复用同一成稿生成管线。
- Markdown `>` 引用统一使用直角矩形、主题色左侧竖线和同色透明衬底；文字随主色变化，也可在「引用背景」中关闭衬底。

默认文章是一篇带表格、Python / SQL 和固定组件的分箱分析示例。代码高亮主题随依赖安装复制到本地，常规 Markdown 编辑和排版不依赖主题 CDN。AI、图床、在线市场及部分图表扩展仍需要相应外部服务；上游分析统计和默认云同步已关闭。

「公众号·楷体红」根据指定公众号文章的实际样式建立；选择后可点「新建同款排版示例」新增文章。详见 [参考样式分析与使用](docs/REFERENCE-WECHAT-KAITI-RED.md)。

## 安装分发扩展

```powershell
pnpm build:extension
```

1. 在 Chrome 打开 `chrome://extensions/`，或在 Edge 打开 `edge://extensions/`。
2. 启用开发者模式，选择「加载已解压的扩展程序」。
3. 加载仓库中的 `vendor/cose/apps/extension/dist` 目录。
4. 避免与商店版 COSE 同时启用，回到编辑器刷新页面。
5. 自行登录公众号后台，点击编辑器「发布」，选择微信公众号并同步。
6. 打开生成的草稿，检查图片、表格、代码、外链和手机预览，再在公众号后台决定是否正式发布。

**建议使用本仓库附带的扩展**：它会直接接收编辑器确认的内联 HTML，避免重新点击复制按钮与读取剪贴板造成内容偏移。其他平台继续复用 COSE 原有适配器。扩展只在本机运行并使用浏览器已有登录状态，不需要把平台密码写进项目。未在本次搭建中登录或写入任何真实平台。

## 样式一致性的边界

预览、复制、HTML 导出和 COSE 正文共用一份内联 HTML，代码高亮也被内联。公众号成稿预览位于隔离 iframe 中，不依赖编辑器页面 CSS，便于发现遗漏样式。

公众号的标签清洗、图片转存、字体替换、深色模式以及平台更新仍可能改变最终显示；本项目不承诺各平台像素级一致。知乎、掘金、CSDN 等平台常使用自己的排版规则，保留分发能力不等于完成样式保真验收。宽表、SVG 与复杂图表应优先做手机预览；必要时将图表或表格转为 PNG。代码尽量控制行宽，保留可复制文本。

当前验证覆盖本地编辑、成稿 HTML、代码高亮、组件渲染及 COSE 消息协议；**真实公众号端到端验收仍需你的账号与实际草稿**。

## 维护文章组件与样式

| 内容                  | 维护位置                                            |
| --------------------- | --------------------------------------------------- |
| 主题方案与固定组件    | `packages/article-kit/src/index.ts`                 |
| 文章排版规范 v1       | `packages/article-kit/styles/v1.css`                |
| 默认示例文章          | `packages/article-kit/templates/starter.md`         |
| 统一成稿生成管线      | `apps/web/src/services/publish/article-artifact.ts` |
| HTML 包装与兼容性检查 | `apps/web/src/lib/article-studio/artifact-html.ts`  |
| COSE 源码与平台适配器 | `vendor/cose`                                       |
| 上游版本记录          | `upstream.lock.json`                                |

v1 组件的名称与内容属性保持兼容，外观通过统一的主题适配层跟随当前主色、字体、字号和行距。所有组件使用直角与细边框，缩略图、正文和成稿使用同一套适配函数。请定期备份 Markdown / CSS。详见 [架构与验收](docs/ARCHITECTURE.md)。

## 开发检查

```powershell
pnpm test            # 本项目语义测试 + COSE 微信适配与成稿直传测试
pnpm test:upstream   # 继承的 shared、core、web 回归测试
pnpm typecheck
pnpm build:all       # 编辑器 + Chromium 分发扩展
```

项目仓库：[hengshu-credit/article-studio](https://github.com/hengshu-credit/article-studio)。

## 上游与许可证

- [doocs/md](https://github.com/doocs/md)：完整编辑器与渲染引擎，WTFPL；许可证见 `docs/LICENSE.doocs-md`。
- [doocs/cose](https://github.com/doocs/cose)：浏览器分发扩展，MIT；许可证见 `vendor/cose/LICENSE`。
- 新增的 Article Studio 代码采用 MIT；上游许可与版权声明分别保留。确切来源提交见 `upstream.lock.json`。
