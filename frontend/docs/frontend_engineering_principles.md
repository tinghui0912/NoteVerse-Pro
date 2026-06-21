# Frontend Engineering Principles

## 文档目的

本文基于前端历史改进记录、当前代码结构和架构优化计划，总结 NoteVerse 前端后续开发应遵守的编码规范、架构设计原则和工程结构经验。

这不是通用前端模板，而是面向 NoteVerse Pro 当前 Next.js 前端的维护准则。它重点回答：

- 页面、组件、hooks、API、类型、practice 渲染逻辑应该放在哪里
- 哪些用户可见行为必须和真实后端契约一致
- 过去已经修过哪些工程问题，后续如何避免回退
- practice 页为什么先采用 Verovio，以及后续如何把其他页面也渐进迁移到 Verovio

## 当前方向更新

浏览器端 MusicXML 渲染和交互式试听现已统一使用 Verovio。

当前维护方向是：

- practice 页继续作为 Verovio 渲染和实时跟随的先行实现
- results、share、editor 共用 Verovio `ListenModal`、独立播放控制器和本地 soundfont 引擎
- 不再新增第二套浏览器端乐谱 renderer 或 renderer-specific 页面逻辑
- review/results/share 中用于展示原图或后端渲染结果的图片产物不属于浏览器 renderer 范围

这意味着后续新增乐谱渲染能力时，应设计在 Verovio adapter / score rendering abstraction 上。

## 一、已经完成或推进过的关键优化

前端已经经历过几轮重要收口：

- 升级核心依赖，修复高风险依赖问题，推进到当前 Next.js / React 版本
- 关闭 `next.config.ts` 中忽略 TypeScript / ESLint 构建错误的配置，让类型和 lint 重新成为质量门禁
- 修复 API key 暴露问题，将敏感值从可提交环境移入本地环境或模板占位
- 修复明暗主题 CSS 变量错位，保持主题语义一致
- 把硬编码英文文案和模板文案迁移到 i18n message 文件
- 增加 route-level `error.tsx`、`not-found.tsx`、`loading.tsx`，改善错误和加载体验
- 收口 API 调用到 `apiClient` 和 `src/lib/api/*`，减少直接 `fetch`
- 统一 `ApiResponse<T>`、`PaginatedResponse<T>` 等类型入口到 `src/types/api/index.ts`
- 拆分大型编辑器组件和复杂 hook，降低单文件复杂度
- 评估状态管理方案，保留当前 Provider 架构，同时拆出高频 hover 状态减少编辑器重渲染
- practice 页从占位 score viewer 迁移到 practice-specific Verovio viewer
- practice 页已经接入后端 REST、WebSocket、AudioWorklet PCM、alignment highlighting、measure/page emphasis 和基础滚动跟随

最重要的经验是：前端质量问题往往不是“UI 不够漂亮”，而是 UI 声称的能力和真实状态不一致。分享权限、profile 编辑、下载权限、订阅切换、practice 分析等地方都必须避免假交互。

## 二、推荐工程结构

当前前端应继续维持以下结构语义：

```text
frontend/
|-- messages/
|   |-- en/
|   `-- zh/
|-- src/
|   |-- app/
|   |   `-- [locale]/
|   |-- components/
|   |   |-- editor/
|   |   |-- layout/
|   |   |-- practice/
|   |   `-- ui/
|   |-- contexts/
|   |-- hooks/
|   |   |-- editor/
|   |   |-- history/
|   |   |-- practice/
|   |   |-- results/
|   |   |-- review/
|   |   |-- share/
|   |   |-- upload/
|   |   `-- queries/
|   |-- i18n/
|   |-- lib/
|   |   |-- api/
|   |   |-- constants/
|   |   |-- editor/
|   |   |-- musicxml/
|   |   |-- practice/
|   |   |-- score/
|   |   `-- utils/
|   |-- types/
|   `-- fonts/
`-- docs/
```

当前结构整体方向是合理的，但仍有几个需要渐进收口的区域：

- 核心业务页面已完成领域拆分；practice 和 history 仍是最大的编排页面，后续只在职责继续增长时拆分
- `src/lib/musicxml/parser.ts` 的纯值解析和 connection target 已拆出；后续继续按实际职责而非行数治理
- `components/score/listen-modal.tsx` 只负责弹窗组合，播放生命周期由 `hooks/score/use-score-preview-playback.ts` 管理
- `hooks/queries` 已经存在，后续 server state 应继续向 query hooks 收口，而不是散在页面里

这些不是必须一次性完成的重构，但后续触碰相关功能时应顺手收口。

### 1. `src/app/[locale]/*`

页面路由、layout、route-level loading/error/not-found 和页面级编排放在这里。

页面文件适合负责：

- 路由参数解析
- 页面级权限和 redirect
- 页面主要状态编排
- 调用 API hooks 或 API helper
- 组合页面 sections
- 连接 WebSocket、AudioWorklet 等页面生命周期资源

页面文件不适合负责：

- 复杂业务算法
- Verovio DOM 操作
- 大型表单或编辑器细节
- API response 结构转换细节
- 可复用 UI primitives
- 高频 DOM highlighting 或 scroll control

经验：practice 页是典型例子。页面应编排 session、WebSocket、麦克风、报告请求和 UI 区块，但 Verovio toolkit、SVG 节点高亮和滚动跟随不应塞进 page component。

### 2. `src/components/*`

组件应按产品域或通用性分层：

| 目录 | 所有权 |
| --- | --- |
| `components/ui` | shadcn/ui 和无领域语义的基础组件 |
| `components/layout` | 导航、布局和全局页面框架 |
| `components/home` | 首页专属展示组件 |
| `components/profile` | 个人资料与头像编辑组件 |
| `components/editor` | 编辑实体、草稿恢复和编辑器专属组件 |
| `components/media` | 可跨页面复用的图片和媒体查看器 |
| `components/score` | 共享 score renderer、播放 shell 和状态 UI |
| `components/practice` | 练习页专属 viewer、controls 和 overlay |

组件根目录只保留真正跨领域的轻量入口。共享试听 UI 位于 `components/score/listen-modal.tsx`，只依赖 `lib/score` contracts；不要从 UI 读取 renderer 或音频播放器内部字段。

经验：大组件拆分不是为了追求文件数量，而是为了把状态、交互和渲染责任分开。编辑器组件、practice score viewer、overlay、card 子组件都应避免变成单个巨型文件。

### 3. `src/lib/api/*`

所有后端 API helper 的归属地。

规则：

- 通过统一 `apiClient` 管理 token、错误处理、认证行为和基础响应解析
- 每个业务域保留自己的 API facade，如 `tasks.ts`、`files.ts`、`shares.ts`、`practice.ts`
- 如果下载、blob、stream、signed URL 等场景需要特殊能力，优先扩展 `apiClient` 或封装专用 helper，不要在页面里绕开
- API helper 应返回前端稳定类型，不让页面反复猜后端字段

经验：之前 `tasks/files/xml` 中存在直接 `fetch`，导致 token 和错误处理分散。后续新增 API 时默认从 `src/lib/api` 进入，不要在页面临时写请求。

### 4. `src/types/*`

跨模块共享类型入口。

规则：

- 后端 API 类型按领域放在 `src/types/api/*`，统一从 `src/types/api/index.ts` 导出
- WebSocket message、practice report、session detail 等稳定契约应有明确类型
- 不要在多个 API helper 中重复定义 `ApiResponse<T>` 或分页类型
- 后端字段变化时同步更新类型、API helper 和页面调用点

经验：类型重复会制造隐性漂移。前端类型要服务契约稳定，不要靠 `any` 或临时断言掩盖后端变更。

### 5. `src/hooks/*`

可复用前端状态和交互逻辑的归属地。

适合放 hooks 的内容：

- autosave
- metadata editor
- history/editor state
- download behavior
- mobile detection
- toast bridge
- XML update orchestration

hooks 不应变成巨型业务对象。复杂 hook 要拆出纯函数、子 hook 或 domain helper，让状态更新、数据转换和副作用边界清楚。

经验：`use-auto-save` 的 `isSaving` 状态问题说明，`useRef` 适合保存非渲染状态，但不能替代需要驱动 UI 的 React state。

### 6. `src/hooks/queries/*`

服务端状态查询和 mutation 的归属地。

当前项目已经引入 `@tanstack/react-query`，并且存在 `use-task-queries.ts`、`use-xml-queries.ts`、`use-share-queries.ts` 和 `use-profile-mutations.ts`。

规则：

- 页面不要重复实现 loading、error、refetch、cache invalidation 细节
- 跨页面复用的 server state 应优先进入 query hook
- query hook 调用 `src/lib/api/*`，不直接散落后端 URL
- 所有 query key 由 `src/lib/query-client.ts` 的 `queryKeys` 生成，形状遵循 `[domain, scope, identity/filter]`；root/prefix factory 用于批量失效，leaf factory 定义完整缓存身份
- filter 和 identity 必须稳定且可序列化，不把 `File`、函数、临时对象引用或未标准化的日期放进 key
- query function 在 API helper 支持时传递 TanStack Query 提供的 `AbortSignal`，让路由切换和 key 变化可以取消旧请求
- mutation 的 domain hook 负责 cache update/invalidation；如果操作只读或状态由 Context 管理，也要明确记录“不触碰 Query cache”
- 页面负责与当前页面语境相关的成功提示；API helper 不发 toast，同一个错误只由一层展示，预期表单错误优先 inline
- client-only transient state 仍保留在页面、component、context 或普通 hook 中，不要全部塞进 React Query

经验：API helper 解决“怎么请求”，query hook 解决“页面如何消费服务端状态”。两者职责不同，不要混在页面里。

### 7. `src/lib/practice/*`

practice 页专属非 React 逻辑。

当前边界：

- `verovio-adapter.ts`：唯一直接理解 Verovio toolkit API 的地方
- `follow-controller.ts`：消费 backend `alignment.update`，决定 note/measure/page highlighting
- `practice-scroll.ts`：滚动阈值和 viewport 跟随策略
- `verovio-types.ts`：practice 渲染相关类型

规则：

- page 不直接操作 Verovio
- React state 不承载高频 SVG highlighting 细节
- follow controller 应操作 committed alignment，不直接把 raw backend candidate 展示给用户
- scroll 逻辑要有 hysteresis，不要每帧跳动

### 8. `src/lib/musicxml/*`

MusicXML 解析、展平、连接和校验逻辑统一归属 `src/lib/musicxml/` domain package。

当前重要文件包括：

- `index.ts`：稳定公共导出面
- `parser.ts`
- `core.ts`
- `elements.ts`
- `flatten.ts`
- `connections.ts`
- `backup.ts`
- `validator.ts`

规则：

- 保持这些逻辑脱离页面组件
- 新增 MusicXML 纯逻辑优先写成可测试函数
- 跨领域消费者优先从 `index.ts` 使用稳定公共面；为避免循环依赖、控制动态加载或缩小 bundle 时允许直接导入子模块
- package 内部依赖保持从 parser/transform/validator 指向 core，不让 core 反向依赖上层模块
- audio preview 暂时留在 package 外，因为它包含播放生命周期与引擎职责；纯 MusicXML timeline 工具形成后再单独迁入

经验：`parser.ts` 仍是当前前端最大文件之一，后续不要再无边界追加校验、连接或播放逻辑；新增能力应先判断属于 parser、transform、validator 还是未来的 playback contract。

### 9. `messages/*`

所有用户可见文案应进入 i18n message 文件。

规则：

- 不在页面里硬编码可见英文/中文文案
- 不保留模板文案、乱码、占位价格或 `href="#"` 死 CTA
- pricing、subscription、share permission、practice 状态等文案必须和真实产品行为一致
- 新增页面时同步补齐 `messages/en` 和 `messages/zh`

经验：乱码和模板文案会直接破坏用户信任。i18n 不是收尾美化，而是产品正确性的一部分。

## 三、编码规范

### 1. 页面不能制造假功能

如果 UI 允许用户编辑、选择或点击，那么这个行为必须真的生效，或者明确标记为不可用 / beta / coming soon。

重点防止：

- 分享权限和过期时间 UI 已选择但请求仍用默认值
- share page 读取 `canDownload=false` 但仍显示下载按钮
- profile 页面允许改 username，但保存请求只提交 disabled email
- subscription 页面只在本地 state 切换 plan，却像真实订阅一样展示
- password reset 同时存在真实流程和模拟流程
- practice 页面展示 AI 分析或跟随能力，但实际使用 mock 或 placeholder

原则：宁可少展示，不要展示一个不会生效的控制。

### 2. API 调用必须统一

新增 API 时：

1. 先在 `src/types/api/` 对应领域模块补契约类型，并从 index 导出
2. 在 `src/lib/api/<domain>.ts` 增加 helper
3. 通过 `apiClient` 走统一 token、错误、base URL、response handling
4. 页面只调用 domain helper 或 hooks，不直接散落 fetch

Blob/download 例外也要封装，不要在页面复制请求细节。

### 3. 类型和构建错误不能被忽略

`next.config.ts` 不应重新开启：

- `typescript.ignoreBuildErrors`
- `eslint.ignoreDuringBuilds`

经验：曾经需要专门修复这类配置，说明忽略构建错误会让真实质量问题沉到用户路径里。后续遇到 typecheck 或 lint 失败，应修代码或明确记录例外，不要关闭门禁。

### 4. 用户可见状态要标准化

loading、empty、error、permission denied、not found、auth required 应有一致的视觉和文案策略。

推荐：

- route-level `loading.tsx` 负责页面级加载
- route-level `error.tsx` 负责不可恢复错误
- 组件内 empty/error state 负责局部可恢复状态
- auth redirect 保留 `returnUrl`
- protected page 不应先 flash 受保护内容再跳转

### 5. 状态边界要跟更新频率匹配

React state 适合：

- session detail
- user/auth state
- form state
- report payload
- page layout state
- latest alignment summary

不适合放进普通 React render loop 的高频状态：

- hover location
- active SVG note ids
- active measure DOM nodes
- scroll target internals
- AudioWorklet frame-level data

经验：编辑器 hover 状态被拆出独立 provider，practice highlighting 放到 imperative controller，都是为了避免高频变化拖累整棵组件树。

### 6. 资源生命周期必须成对管理

需要显式清理的资源包括：

- blob object URL
- WebSocket
- MediaStream tracks
- AudioContext
- AudioWorklet node
- timers / intervals
- pending fetch / AbortController
- Verovio-rendered DOM side effects

经验：大谱、多页预览、长练习会话会放大资源泄漏。创建 object URL 后必须考虑 revoke；打开 WebSocket 后必须考虑 pause/finish/unmount；获取麦克风后必须 stop tracks。

## 四、架构设计原则

### 1. 保持页面责任和领域逻辑分离

页面是编排层，不是所有逻辑的容器。

判断一段逻辑是否该离开页面：

- 是否超过一个页面会用
- 是否需要独立测试
- 是否涉及非 React imperative API
- 是否包含复杂状态机
- 是否有明确输入/输出契约
- 是否频繁更新，容易触发多余渲染

满足任意几条，就应考虑放到 `components/<domain>`、`hooks`、`lib/<domain>` 或 `lib/api`。

### 2. Verovio 迁移应覆盖浏览器端 MusicXML 渲染链路

practice 页是第一阶段先行方案；results、share、editor 的 `ListenModal` 交互式播放链路也已完成 Verovio 迁移。

第一阶段选择 practice 先行的原因：

- practice 需要实时 score following、SVG element targeting、time lookup、DOM-level highlighting、auto-scroll
- Verovio 更适合 practice 的实时反馈和 DOM 操作
- 交互式播放通过独立 controller 保持 cursor、seek、tempo 和 soundfont 行为

当前长期方向：

- results、share、editor 复用 Verovio ListenModal 和独立播放控制器
- 共享 score renderer abstraction，避免每个页面各自操作 Verovio
- 页面只消费 renderer 输出和交互接口，不直接依赖 Verovio toolkit
- review 的原图/识别预览，以及 results/share 的 durable backend preview image，不属于浏览器 renderer 路径；除非产品需求改变，否则继续作为后端产物展示

原则：最终统一的是浏览器端 MusicXML renderer 和交互式播放能力，不是为了“全量 Verovio”而替换合理的后端图片产物。迁移必须通过 adapter、共享组件、真实样本和功能对等验证渐进完成。

Score preview 的当前边界：

- `ScoreRenderer` 负责加载、适配容器和释放 renderer DOM/toolkit
- `ScorePlaybackController` 负责 play、pause、stop、step seek、tempo、状态快照和播放事件
- `ScoreCursorController` 负责 reset、step sync、visibility 和 auto-scroll
- `VerovioScorePreviewController` 实现组合后的 `ScorePreviewController`
- `ListenModal` 拥有 React UI 状态、requestAnimationFrame 和 ResizeObserver；controller 拥有 Verovio、AudioContext、调度器/计时器和渲染 DOM
- dispose 必须停止播放、关闭 AudioContext、阻止已释放实例继续分发事件并清空 renderer DOM

### 3. Practice 页要四层分离

推荐边界：

1. Page orchestration：session、WebSocket、麦克风、报告、页面 UI
2. Practice score container：初始化 Verovio、加载 MusicXML、渲染 SVG、暴露高亮入口
3. Verovio adapter：封装 toolkit API、时间/元素映射、DOM helper
4. Follow controller：消费 alignment.update，执行 committed highlighting 和 scroll/page follow

任何修改 practice 页时，都要先判断自己改的是哪一层。

### 4. 后端契约优先于前端猜测

前端不应从 UI 状态猜后端结果。

例子：

- share 权限以后端返回的 `canDownload` / `canEdit` 为准
- authenticated share flow 要等 auth 初始化结束后再 fetch share data
- practice session state 以后端 REST/WebSocket 消息为准
- report payload 使用后端结构化字段，不继续旧 mock 卡片模型
- rendered file 显示以 MIME type 为准，不假设一定是 PNG

### 5. Product copy 是契约的一部分

首页、定价、订阅、share、practice 状态文案都不能超出现有产品真实能力。

避免：

- dead CTA
- 模板行业文案
- 假价格
- 未接入 billing 却像真实升级
- practice 未完成却不标 beta
- 错误状态只显示技术错误而不给下一步动作

## 五、Practice Verovio 和实时练习规则

### 1. 数据流

后端到前端：

1. page 创建 practice session
2. page 打开 practice WebSocket
3. 后端发送 `alignment.update`
4. page 保存 latest alignment summary
5. `PracticeScoreViewer` 转发给 `follow-controller`
6. controller 更新 SVG class 和 scroll state

score load：

1. page 解析 task/source/share context
2. 获取与 backend practice session 一致的 MusicXML
3. `verovio-adapter` 加载 MusicXML
4. 多页 SVG stacked rendering
5. 准备 time lookup 和 element mapping

### 2. Highlighting

使用 CSS class 操作 SVG，不要每次 alignment 都全量重渲染。

推荐类名：

- `.practice-note-active`
- `.practice-note-recent`
- `.practice-measure-active`
- `.practice-page-active`

只更新当前和上一批 active nodes。

### 3. Mapping 策略

MVP 优先：

- 使用 backend `timestamp_ms`
- 调用 Verovio `getElementsAtTime(timestamp_ms)`
- 高亮返回元素

Fallback：

- 使用 `measure_number`
- 高亮对应 measure
- 保留上一 note，避免视觉反馈完全消失

未来：

- 如果后端提供更丰富 timeline 或 xml id，再直接定位 rendered element

### 4. Scroll 策略

不要每次更新都滚动。

规则：

- active note 在安全视口区域内时不滚动
- 越过下阈值才平滑滚动
- live session 默认不向上滚动
- page focus 要有 visibility threshold，避免过度跳页
- 短暂 note drop 可以保留上一 highlight，减少闪烁

### 5. Audio pipeline

当前 practice 页要求 `AudioWorklet`。

规则：

- 不保留 `ScriptProcessorNode` fallback
- unsupported browser fail fast，并显示明确提示
- 客户端继续发送 16k PCM binary frames
- WebSocket heartbeat 保持长会话活跃
- 后续优化 frame sizing 和 supported browser baseline

## 六、测试和质量门禁

推荐常规检查：

```powershell
cd frontend
npm run lint
npm run typecheck
npm run build
```

当前已配置 Vitest/RTL 与 Playwright，常规改动应增加：

```powershell
npm run test
```

按变更类型选择验证：

- API helper：测试 request payload、auth behavior、error handling、blob/download path
- share/results/profile：验证 UI 控制真的影响请求或后端状态
- i18n/copy：检查 `messages/en` 和 `messages/zh` 都有对应 key
- route protection：验证 logged-out direct visit 和 `returnUrl`
- editor：验证 autosave、entity update、hover 性能和大文件交互
- practice：验证 session create、WebSocket init、PCM streaming、alignment highlight、pause/resume/finish、report request
- Verovio：验证真实 MusicXML、多页 SVG、highlight、scroll、shared-link entry
- blob/image pages：验证 object URL cleanup 和多页响应性

经验：前端 P0 问题多是用户可见正确性问题，不是编译能完全覆盖的。typecheck/lint/build 是底线，核心路径还需要手动或自动行为验证。

## 七、文档维护规范

当前文档应保持分工：

- `improvement-roadmap.md`：早期审查任务和历史完成状态
- `frontend_architecture_optimization_plan.md`：当前权威执行计划、优先级、依赖关系和验收标准
- 本文：后续开发长期准则

更新规则：

- 新任务状态优先更新 `frontend_architecture_optimization_plan.md`，避免在旧 roadmap 重复维护两套状态
- 如果 renderer/following 架构变化，同步更新本文和当前执行计划
- 如果 UI 行为从 mock 变真实或从真实变 beta，必须同步文案和 docs
- 不要让 docs 保留 starter/scaffold 语义

## 八、最容易复发的问题清单

后续 code review 重点检查：

1. 页面里直接写 `fetch`，绕过 `apiClient` 和 `src/lib/api/*`。
2. 新 API 类型散落在 helper 或页面里，没有进入 `src/types/api/` 领域包。
3. UI 控制显示可用，但 payload 没绑定或后端不支持。
4. 读取了后端权限字段，但按钮/菜单仍允许操作。
5. route protection 依赖 API 401，导致 protected UI flash。
6. 用户可见文案硬编码、乱码、模板化或没有 i18n key。
7. `next.config.ts` 重新忽略 type/lint build errors。
8. 大组件继续膨胀，而不是拆成 domain components、hooks、lib helpers。
9. 高频状态放进全局/页面 React state，造成重渲染。
10. object URL、WebSocket、AudioContext、MediaStream 没有 cleanup。
11. practice page 直接操作 Verovio toolkit 或 SVG DOM，而不是走 adapter/controller。
12. 页面绕过共享 Verovio controller 直接操作 toolkit 或播放引擎。
13. alignment.update 被直接用于 UI 高亮，没有 committed/guard/fallback 策略。
14. subscription、password reset、practice report 等功能保留模拟逻辑但 UI 未说明。
15. 新增文档不更新旧优先级状态，导致团队分不清当前问题和历史问题。

## 九、后续开发推荐流程

新增或修改前端功能时：

1. 先判断是页面编排、组件、hook、API helper、类型、practice adapter/controller，还是 i18n 文案。
2. 先确认后端契约和真实产品能力，不要先做假 UI。
3. 为请求/响应补 `src/types/api/` 对应领域类型。
4. 在 `src/lib/api/<domain>.ts` 封装 API。
5. 页面只负责组合和生命周期，不承载复杂领域逻辑。
6. 如果逻辑可复用或可测试，拆到 hook 或 `src/lib/<domain>`。
7. 如果是 practice 渲染/跟随，保持 page/viewer/adapter/controller 分层。
8. 补齐 loading、empty、error、permission denied、auth redirect 状态。
9. 同步 `messages/en` 和 `messages/zh`。
10. 运行 lint/typecheck/build，并做核心行为验证。
11. 更新相关 docs。

## 十、判断前端代码是否健康的简短标准

一段前端代码通常是健康的，如果它满足：

- 页面职责清楚，复杂逻辑不堆在 `page.tsx`
- API 调用统一，类型入口稳定
- UI 控制和真实后端行为一致
- 权限、认证和下载行为前后端语义一致
- 文案完整、可本地化、没有乱码或模板残留
- 加载、错误、空状态和权限状态清楚
- 高频交互不会拖垮 React render
- 资源生命周期有 cleanup
- practice 相关逻辑遵守 Verovio adapter 和 follow controller 边界
- 测试或手动验证覆盖用户能感知的行为

反过来，如果一个改动需要解释“这个按钮现在只是假的”“这里先直接 fetch”“这个类型先 any”“这个页面先不做错误态”“这个资源暂时不用清理”，它很可能正在制造下一轮前端债。

Share/review ownership update (2026-06-20): share authentication/access, canonical share XML, permission-gated actions, and cancellable images are composed outside the page; review task validation, confirmation, comparison images, and carousel presentation have explicit hook/component owners. `can_download` and `can_edit` must directly control the relevant UI actions.

Anonymous share boundary update (2026-06-21): only `/share/[shareId]` is public. Share data, XML, and allowed downloads may load without a session after auth initialization; bookmark, editor, practice, history, profile, upload, review, and results remain account-protected and preserve the full localized share-origin `returnUrl` when entering login.

Editor ownership update (2026-06-20): document queries, draft recovery, validation, source-aware save targets, autosave state, and original-image cleanup are composed by `use-editor-document`; page header/actions and all editor dialogs live under `components/editor`. Editor routes require explicit `current` or `final` sources, and the product XML API does not expose internal `enhanced_xml` artifacts.

Results ownership update (2026-06-20): task/XML queries and image resource cleanup are composed by `use-results-resources`; metadata, preview, fingering/listen actions, downloads, and sharing live under `components/results`. Share controls must represent fields actually supported by the create-share contract.

History ownership update (2026-06-20): upload/share filters and pagination are independent tab state, selection is reset at tab boundaries, batch actions compose domain mutation hooks, and thumbnail access requests are cancellable with owned object URLs revoked on cleanup. History cards, toolbar, status, and pagination live under `components/history`.

Practice resource ownership update (2026-06-20): session references and REST controls live in `use-practice-session`; WebSocket/heartbeat, AudioWorklet/MediaStream, and MediaRecorder/object URLs each have a dedicated hook with paired cleanup. The practice route composes those hooks and UI components while committed alignment and SVG work remain in the viewer/controller boundary.

Verovio ownership update (2026-06-20): `lib/score/verovio` owns the shared WASM module loader, per-viewer toolkit instances, MusicXML sanitization, generic page/time lookup, and relayout. `VerovioScoreViewer` owns generic rendering states and multi-page DOM; practice imports that layer while keeping follow commit policy, highlighting, and scrolling in `lib/practice`.

Playback spike update (2026-06-20): Verovio base64 MIDI and XML-ID timemap data feed a NoteVerse-owned playback timeline/controller; `@tonejs/midi` is parser-only and `soundfont-player` is isolated behind `VerovioAudioEngine`. Playback code has a separate entry from renderer code. The shipped asset set currently guarantees acoustic piano only, so unsupported programs fall back to piano and the product must not claim full instrumentation fidelity.

Interactive listen migration update (2026-06-21): results, share, and editor use the single shared Verovio preview path. `ListenModal` contains no toolkit internals; its score playback hook dynamically loads the controller, while the Verovio preview controller owns SVG pages, cursor DOM, playback, relayout, AudioContext, and cleanup. Backend-rendered comparison and preview images remain valid product artifacts. The previous renderer backend, compatibility patch, and dependencies have been removed.

Post-migration ownership update (2026-06-21): editor-only hooks live under `hooks/editor`, editor undo history is explicitly named, draft/score lookup utilities live under `lib/editor`, API contracts are domain modules behind `types/api/index.ts`, and score-preview playback state lives in a dedicated score hook. The frontend package is `noteverse-pro-frontend`; frontend CI runs lint, typecheck, 43 unit/component tests, build, and 6 deterministic Playwright tests.

## Bottom Line

NoteVerse 前端后续维护最重要的原则是：用户看到的每一个控制、状态和文案都必须对应真实能力。

工程上要继续坚持：

- API、类型、i18n、错误状态收口
- 页面编排和领域逻辑分离
- 浏览器端 MusicXML 渲染和交互式播放统一使用 Verovio
- 保留有明确产品用途的后端原图和预览图片产物
- 高频渲染和资源生命周期显式管理
- 不再关闭 type/lint/build 质量门禁

前端的好架构不是把所有东西抽象掉，而是让真实产品能力、后端契约和用户界面始终对得上。
