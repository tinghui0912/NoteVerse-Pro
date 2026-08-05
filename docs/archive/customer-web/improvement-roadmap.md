# NoteVerse Pro Frontend 改进任务计划

> 基于 2026-04-11 代码审查报告整理，按优先级分为 P0（必须立即修复）、P1（核心改进）、P2（质量提升）、P3（长期优化）四个等级。

> **状态说明（2026-06-18）：** 本文保留早期审查任务和历史完成记录。当前 Customer Web 架构基线位于 [`customer-web_architecture_baseline.md`](../../../apps/customer-web/docs/customer-web_architecture_baseline.md)；不要在两份文档中重复维护状态。

---

## P0 — 🔴 紧急：安全与构建完整性

> 这些问题直接影响安全和代码可靠性，必须在任何新功能之前解决。

### P0-0: 升级核心依赖解决高危漏洞

- [x] 升级 Next.js (至 v16，解决 v14 漏洞) 和 React 19。
- [x] 升级 Next-Intl 及其他报红依赖。
- [x] 进行全面的兼容性测试（验证 `npm run build` 和关键页面）。

### P0-1: 修复 API Key 泄露

- [x] 将 `.env` 中的 `GEMINI_API_KEY` 移至 `.env.local`（已在 `.gitignore` 中排除）
- [x] 立即前往 Google AI Studio 轮换（吊销 + 重新生成）该 API Key
- [x] 在 `.env` 中仅保留 `GEMINI_API_KEY=` 占位（或添加 `.env.example` 作为模板）
- [x] 检查 Git 历史，确认该 Key 是否已被推送到远程仓库；如是，考虑使用 `git filter-repo` 清除

**涉及文件**：
- `.env`
- `.env.local`（新建）
- `.env.example`（新建，可选）

---

### P0-2: 开启 TypeScript 和 ESLint 构建检查

- [x] 将 `next.config.ts` 中的 `ignoreBuildErrors` 改为 `false`
- [x] 将 `next.config.ts` 中的 `ignoreDuringBuilds` 改为 `false`
- [x] 运行 `npm run build`，收集所有类型错误并逐一修复
- [x] 运行 `npm run lint`，修复所有 lint 问题
- [x] 配置 `.eslintrc.json`，添加适合项目的规则集（推荐 `@typescript-eslint/recommended`）
- [ ] （可选）配置 Prettier + eslint-config-prettier 统一代码格式

**涉及文件**：
- `next.config.ts`
- `.eslintrc.json`（检查/更新）
- 项目中所有 `.ts` / `.tsx` 文件（按错误修复）

---

### P0-3: 修复暗色/亮色模式 CSS 变量颠倒

- [x] 将 `globals.css` 中 `:root` 的色值修改为**亮色主题**的正确值
- [x] 将 `.dark` 类的色值修改为**暗色主题**的正确值
- [x] 根据实际需求决定默认主题：
  - 若默认暗色 → `<html className="dark">` 保持不变
  - 若默认亮色 → 移除 `<html>` 上的 `className="dark"`
- [x] 验证所有页面在两种模式下的显示效果

**涉及文件**：
- `src/app/globals.css`
- `src/app/[locale]/layout.tsx`

---

### P0-4: 修复硬编码英文文案

- [x] 在首页 `page.tsx` 中搜索所有硬编码英文字符串
  - `"From air to warehouse, we move your goods with precision and care."` → 移至 i18n
  - `"View details"` → 移至 i18n
  - `"Testimonials"` → 移至 i18n
- [x] 全局搜索项目中其他可能遗漏的硬编码文案
- [x] 在 `messages/zh/` 和 `messages/en/` 中补充对应翻译

**涉及文件**：
- `src/app/[locale]/page.tsx`
- `messages/zh/home.json`
- `messages/en/home.json`
- 其他可能遗漏的页面组件

---

## P1 — 🟠 核心改进：健壮性与一致性

> 提升应用的健壮性和代码一致性，为生产环境做准备。

### P1-1: 添加 Error Boundary

- [x] 在 `src/app/[locale]/error.tsx` 创建全局错误回退 UI
- [x] 在 `src/app/[locale]/not-found.tsx` 创建 404 页面（如尚未有）
- [x] 为编辑器等关键页面添加独立的 `error.tsx`
- [x] 确保错误页面支持 i18n

**新建文件**：
- `src/app/[locale]/error.tsx`
- `src/app/[locale]/not-found.tsx`（如需要）
- `src/app/[locale]/editor/[id]/error.tsx`

---

### P1-2: 添加 Loading UI

- [x] 在 `src/app/[locale]/loading.tsx` 创建全局加载 UI（骨架屏或 Spinner）
- [x] 为关键路由页面添加独立的 `loading.tsx`（如 history、editor）
- [x] 使用 `Suspense` 包裹客户端组件中的异步操作

**新建文件**：
- `src/app/[locale]/loading.tsx`
- `src/app/[locale]/history/loading.tsx`
- `src/app/[locale]/editor/[id]/loading.tsx`

---

### P1-3: 统一 API Client 调用

- [x] 重构 `tasks.ts` 的 `archiveTasks()` 函数，使用 `apiClient` 而非直接 `fetch`
- [x] 重构 `files.ts` 的 `exportExcel()` 函数，使用 `apiClient` 而非直接 `fetch`
- [x] 重构 `xml.ts` 的 `loadXml()` 函数，使用 `apiClient` 而非直接 `fetch`
- [x] 如果 `apiClient` 不支持某些场景（如流式下载），扩展其 API 而非绕过
- [x] 确保所有请求的 Token 管理和错误处理走统一路径

**涉及文件**：
- `src/lib/api/tasks.ts`
- `src/lib/api/files.ts`
- `src/lib/api/xml.ts`
- `src/lib/api-client.ts`（可能需要扩展）

---

### P1-4: 消除类型定义重复

- [x] 移除 `src/lib/api-client.ts` 中的 `ApiResponse<T>` 和 `PaginatedResponse<T>` 重复定义
- [x] 统一从 `@/types/api` 导入这些类型
- [x] 确保 `api-client.ts` 的导出不影响其他模块的导入链

**涉及文件**：
- `src/lib/api-client.ts`
- `src/types/api.ts`
- 所有引用了 `ApiResponse` 的文件

---

### P1-5: 添加 Next.js Metadata

- [x] 在 `src/app/[locale]/layout.tsx` 中导出 `metadata` 或 `generateMetadata`
- [x] 配置 `title`、`description`、`keywords`、`openGraph`、`twitter` 等 SEO 字段
- [x] 为各页面添加独立的 metadata（如编辑器、历史记录等）
- [x] 支持 i18n 的 metadata（根据 locale 动态生成）

**涉及文件**：
- `src/app/[locale]/layout.tsx`
- 各路由页面的 `page.tsx`

---

### P1-6: 修复 `useAutoSave` 的 `isSaving` 状态问题

- [x] 将 `isSavingRef` 改为 `useState` 或通过 `useCallback` + 强制更新来驱动 UI 响应
- [x] 确保消费者能正确获取保存状态（例如显示保存指示器）

**涉及文件**：
- `src/hooks/use-auto-save.ts`

---

## P2 — 🟡 质量提升：工程化与可维护性

> 提升项目长期可维护性和开发体验。

### P2-1: 引入测试框架

此任务已迁移到当前执行计划的 P0-2。最终技术组合为：

- Vitest + React Testing Library：单元、hooks 和组件测试
- MSW：需要真实 HTTP 语义时的可选请求级集成测试
- Playwright：Next.js 路由、关键用户流程、Verovio WASM 和视觉行为
- pytest：继续负责 FastAPI 后端测试，不被前端工具替代

当前架构基线、脚本和验收标准只在 `customer-web_architecture_baseline.md` 中维护。

---

### P2-2: 拆分大文件

- [x] 将 `card-based-editor.tsx`（603 行）拆分为：
  - `components/editor/note-card.tsx`
  - `components/editor/chord-card.tsx`
  - `components/editor/add-note-card.tsx`
  - `components/editor/add-button.tsx`
  - `components/editor/drag-scroll-container.tsx`
  - `components/editor/bottom-sheet-context.tsx`
  - `components/editor/card-based-editor.tsx`（主组件，组合上述子组件）
- [x] 将 `use-entity-editor.ts`（462 行）重构：
  - 提取 `insertEntity()` 为独立函数
  - 提取 `updateExistingEntity()` 为独立函数
  - 简化 `updateEntity` 回调的逻辑分支

**涉及文件**：
- `src/components/editor/card-based-editor.tsx`
- `src/hooks/use-entity-editor.ts`

---

### P2-3: 考虑升级状态管理方案

- [x] 评估将编辑器的 Context 嵌套替换为 `zustand` 或 `jotai`
  - **结论：不迁移。** 当前 3 层 Provider 已用 `useMemo` 优化，架构合理，迁移成本高收益低
- [x] 评估引入 `react-query` / `swr` 管理服务端数据状态
  - **结论：推荐 SWR（轻量、与 Next.js 契合），但非紧急，降为 P3 优先级**
- [x] 拆分 `hoveredCardLocation` 为独立的 `HoverStateProvider`
  - 避免鼠标移动时触发整棵编辑器组件树重渲染
  - 新增 `contexts/hover-state-context.tsx`

---

### P2-4: 配置 Git Hooks

- [ ] 安装 `husky` + `lint-staged`
- [ ] 配置 pre-commit hook：
  - 运行 `eslint --fix` 对暂存文件
  - 运行 `prettier --write` 对暂存文件
- [ ] 配置 pre-push hook：
  - 运行 `tsc --noEmit` 全量类型检查
- [ ] （可选）配置 commit message 规范（commitlint + conventional commits）

---

### P2-5: 添加 API 请求竞态控制

- [ ] 在 `api-client.ts` 中添加 `AbortController` 支持
- [ ] 为 `get`/`post` 等方法添加可选的 `signal` 参数
- [ ] 在组件卸载时自动取消未完成的请求
- [ ] 如引入 `react-query`，可通过其内置的取消机制自动处理

**涉及文件**：
- `src/lib/api-client.ts`
- 调用 API 的 hooks 和组件

---

### P2-6: 移除冗余依赖

- [ ] 移除 `dotenv` — Next.js 内置 `.env` 支持，无需额外安装
- [ ] 检查 `patch-package` 的补丁内容，评估是否仍需要
- [ ] 清理 `tCommon` 等声明但未使用的变量

---

## P3 — 🔵 长期优化：性能与可观测性

> 面向生产环境的长期优化项。

### P3-1: 优化 Server Component 使用

- [ ] 将首页大部分内容改为 Server Component（当前整页为 `'use client'`）
  - 仅将需要交互的部分（CTA 按钮、导航）包裹为客户端组件
  - 静态内容（功能介绍、定价、推荐语）在服务端渲染
- [ ] 评估其他页面的 SSR/SSG 可能性
- [ ] 使用 `@next/bundle-analyzer` 分析客户端 bundle 大小

---

### P3-2: 接入错误监控

- [ ] 接入 Sentry（或 LogRocket）
  - 安装 `@sentry/nextjs`
  - 配置 `sentry.client.config.ts` + `sentry.server.config.ts`
  - 在 Error Boundary 中上报错误
- [ ] 在 API Client 的 `handleResponse` 中上报 API 错误日志

---

### P3-3: 接入性能监控

- [ ] 配置 Next.js Analytics（Vercel） 或 Web Vitals 上报
- [ ] 监控关键指标：LCP、FID、CLS、TTFB
- [ ] 为编辑器等复杂页面设置性能基线

---

### P3-4: 配置 CI/CD Pipeline

- [ ] 创建 `.github/workflows/ci.yml`（或对应平台配置）
- [ ] CI 流程包含：
  - `npm ci` + `npm run lint` + `npm run typecheck`
  - `npm run test`（单元测试通过后）
  - `npm run build`（构建验证）
- [ ] CD 流程包含：
  - 自动部署到 staging（PR 合并到 develop）
  - 手动部署到 production（release tag）

---

### P3-5: 添加路由保护中间件

- [ ] 在 `middleware.ts` 中添加认证检查逻辑
  - 保护需要登录的路由（editor、history、profile、upload 等）
  - 未登录用户重定向到 `/login?returnUrl=...`
- [ ] 评估是否需要基于角色的访问控制

**涉及文件**：
- `src/middleware.ts`

---

### P3-6: 价格国际化

- [ ] 将硬编码的 `¥0`、`¥30`、`¥99` 移至翻译文件
- [ ] 使用 `Intl.NumberFormat` 根据 locale 格式化货币
- [ ] 支持不同地区的定价策略（如美元/人民币切换）

---

## 附：修复优先级速查

```
紧急度     任务编号     简述
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔴 P0-1    API Key 泄露修复
🔴 P0-2    开启 TypeScript / ESLint 检查
🔴 P0-3    修复暗色/亮色 CSS 变量颠倒
🔴 P0-4    修复硬编码英文文案
🟠 P1-1    添加 Error Boundary
🟠 P1-2    添加 Loading UI
🟠 P1-3    统一 API Client 调用
🟠 P1-4    消除类型定义重复
🟠 P1-5    添加 Next.js Metadata / SEO
🟠 P1-6    修复 useAutoSave isSaving 状态
🟡 P2-1    引入测试框架 + 核心测试
🟡 P2-2    拆分大文件（编辑器组件 + Hook）
🟡 P2-3    状态管理方案升级评估
🟡 P2-4    配置 Git Hooks
🟡 P2-5    API 请求竞态控制
🟡 P2-6    移除冗余依赖
🔵 P3-1    Server Component 优化
🔵 P3-2    接入错误监控 (Sentry)
🔵 P3-3    接入性能监控
🔵 P3-4    配置 CI/CD Pipeline
🔵 P3-5    路由保护中间件
🔵 P3-6    价格国际化
```
