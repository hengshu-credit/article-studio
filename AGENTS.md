# Article Studio

- 不新建分支，不 stage、commit 或 push，除非用户明确要求。
- 不使用子智能体，除非用户明确要求。
- 保留 doocs/md 的编辑器和 doocs/cose 的平台适配能力。
- 本地可维护的文章规范放在 packages/article-kit，v1 组件命名和属性契约保持兼容；组件外观通过 applyComponentTheme 随当前主题统一适配。
- 公众号预览、复制、导出和 COSE 分发必须复用 services/publish/article-artifact.ts 的产物。
- 组件缩略图、正文与成稿使用同一套主题适配和内联样式；不要依赖页面 CSS 或远端字体。
- 修改发布管线须验证 HTML、代码高亮和组件内容；pnpm test、pnpm typecheck、pnpm build:all。
- 不自动向任何真实平台写入或发布文章；联调可使用本地协议桩。
