# Customer Web Engineering Principles

本文定义 NoteVerse Pro 前端的长期工程准则。页面、领域逻辑、API、类型、
资源生命周期和用户可见文案都应表达当前真实产品能力。

## 领域与页面职责

路由负责 Next 参数边界和页面组合。领域状态、命令编排、API 适配、query identity
和缓存 consequence 由明确的领域 owner 承担；共享能力按其资源生命周期组织。

- `src/features/<domain>/`：已建立 feature boundary 的领域拥有自己的 UI、application
  adapters、API、query keys、queries、cache consequences 和 routes/route state。
- `src/features/imports/`：Import submission、activity/job lifecycle 与 Review/editor adapter。
- `src/features/library/`：个人 folders、favorite、organization、浏览和批量 Move/Favorite。
- `src/features/scores/core/`：Score detail/capability、revision/assets、editor adapter 和下载。
- `src/features/scores/collaboration/`：Invite、Membership、self Leave、pending invites 和外部 Invite 页面。
- `src/features/scores/guest-preview/`：owner credential commands 与独立 public bearer presentation。
- `src/features/scores/` parent：产品页面组合、Score route locations 和跨生命周期 cache consequences。
- `src/features/notifications/`：durable Notification history/read-state 的 API、query/cache、presentation、target 与 Center/Bell。
- `src/features/account/profile/`：current Profile、Avatar API、表单与 512x512 PNG crop。
- `src/features/account/security/`：Security overview、password/email-change workflow 与 confirmation。
- `src/features/account/sessions/`：authenticated refresh-session inventory、revoke 和 presentation。
- `src/features/authentication/`：browser session/principal、login/register/verification/recovery 与 safe returnUrl。
- `src/app/[locale]/`：route entry、layout、loading/error/not-found 和页面组合。
- `src/components/`：共享 UI、shell、基础组件和跨领域 presentation。
- `src/lib/`：跨领域 browser infrastructure 与共享纯能力。
- `src/generated/api/`：由后端 OpenAPI 生成的 HTTP DTO。
- `messages/en/`、`messages/zh/`：用户可见文案。

其他当前领域继续由其明确的 components/hooks/lib owner 管理；这些位置不是所有
领域的唯一结构。纯逻辑不依赖页面或 React。高频 DOM 更新留在 controller，避免
驱动整棵 React 树重渲染。

Library 的复杂选择、folder/dialog 状态和 query coordination 属于 Library feature。
Score Delete 和 membership Leave 仍由各自领域拥有，Library 页面仅调用这些命令。Score parent consequences 组合各 lifecycle cache owner，
local cache 不相互依赖。Score deletion 失效 Guest Preview 和 Import 域；Leave 不改变
这两项 authority。Frontend 只消费 backend ScoreCapabilities，不从角色重新推导授权。

## API、类型与服务端状态

Customer HTTP 请求通过 OpenAPI generated SDK operation 发起；method、path、
path params、query 与 body encoding 由 generated code 拥有。Import、Library 与 Score 各生命周期的
API adapter 位于各自 feature，其余领域使用各自明确的当前 adapter owner。
Adapter 只进行前端语义适配和 generated result 投影。统一 browser transport 管理
credentials、CSRF、refresh/retry、redirect、AbortSignal、错误与 observability。
下载和 stream 同样使用 generated operation；native media/EventSource 与
外部 signed storage upload 使用各自明确的 browser transport。

HTTP DTO 直接导入生成类型。后端契约变更后运行 `npm run generate:api`；
视图模型、表单状态和浏览器内部消息由前端拥有。API helper 返回稳定类型，
页面不猜测字段、不通过 `any` 掩盖契约问题。

- Import、Library、Notifications、Account 和 Score core/Collaboration/Guest Preview 的 query keys、queries 与
  cache consequences 各有独立 owner。`src/lib/query-client.ts` 配置 QueryClient，并管理其余当前领域的 keys。
  Identity 使用稳定、可序列化的 domain/scope/identity，不放 File 或函数。
- Query function 在 API helper 支持时传递 AbortSignal，取消失效请求。
- Mutation 的领域 hook 调用所属领域的 cache consequence；跨领域调用不复制目标领域的 keys。
- 页面拥有当前语境的成功提示；API helper 不发 toast，错误由一层展示。
- 客户端临时状态留在 component、Context 或普通 hook。
- Next server 在 `next.config.ts` 校验必需的 backend origin；固定 Customer cookie/header identity 使用 generated browser protocol projection。

Notification Center 组合 Collaboration pending actions 与 durable Notification Updates，
但不接管 Invite API、query keys 或 accept/decline 命令。Bell 合并 pending action contribution
与 server unread count，不写入新的计数 authority；两处复用同一 query state。
`notifications.changed` 仅收敛 Notification history/read-state，不代表 pending Invite change。

Account Profile read adapter 同时 hydrate Authentication principal；current user 不另建 TanStack profile cache。
`features/account/cache.ts` 组合 Account projection consequences：password change 收敛 security
与 sessions，email confirmation 收敛 security 并尝试刷新 current principal；后续 refresh 失败
不改变 confirmation 成功。Sessions 请求显式限制为 100，device label 仅作 User-Agent presentation。
SettingsShell 只负责跨 Account/Billing 的导航与布局。Authentication feature 拥有 session/principal
和五个 auth entry flows；route files 仅组合 feature。email-change confirmation 仍由 Account Security 拥有，
AuthCard 仅为两个 lifecycle 共享的 presentation。

Authentication 状态区分 bootstrapping、authenticated、anonymous 与 unavailable。Profile 401 才确认
anonymous；bootstrap 的 network/5xx failure 必须报告并投影 unavailable。已有 principal 的 transient
refresh failure 保留身份并 reject/report。Login 200 在设置 session cookies 的同时返回 canonical
ProfileUserRead，直接建立 principal，不再发第二次 Profile GET。

Logout 成功、password reset 和 principal switch 清除私有 QueryClient server-state。Reset 撤销所有
既有 sessions，并清除当前 browser session/refresh/CSRF cookies。returnUrl 必须是 URL parser 验证的
same-origin app-relative path intent；拒绝 external/backslash open redirects。Next proxy 只作 cookie
existence soft gate，不是 authenticated principal authority。QueryClient → Authentication → Realtime
保持 provider 顺序；Realtime 只依赖 Authentication public state。

## 产品能力、权限与文案

每个可点击、可选择或可编辑的 UI 都对应真实行为；不可用能力应有明确状态。
权限以服务端返回的 capability 为准，并直接控制展示与操作。

用户可见文案进入中英文 message 文件。loading、empty、error、permission denied、
not found 和 auth required 保持一致；预期表单错误优先 inline，不展示原始后端
异常。受保护页面等待 auth 初始化并保留 returnUrl，避免先显示受保护内容。
订阅、下载、分享和 Practice 状态文案必须与真实请求和运行状态一致。

## 资源与状态所有权

每个可释放资源都有明确 owner 和成对 cleanup：object URL、EventSource、
WebSocket、MediaStream track、AudioContext、AudioWorklet、timer、AbortController、
Verovio toolkit 与 DOM 副作用。异步初始化完成后仍需检查实例是否有效。
销毁阻止后续事件，并按资源所有权释放；借用资源由其 owner 关闭。

React state 保存需要渲染的状态；ref 保存非渲染状态。hover、SVG active nodes、
scroll internals 和 AudioWorklet 帧数据不进入普通页面 render loop。
领域快照与应用资源状态各有清楚的类型和更新来源。

## 乐谱、编辑与 Review

浏览器 MusicXML 解析和校验属于 `src/lib/musicxml/`；编辑逻辑属于
`src/lib/editor/` 和 editor domain。消费者通过稳定公共面使用纯解析和转换能力，
内部依赖从 parser/transform/validator 指向 core。

Practice/editor 等需要乐谱结构、定位、光标和音符反馈的交互式场景使用浏览器
Verovio。详情、分享和公开页面使用后端 render assets 与 playback audio assets，
通过封面轻量播放控件试听。外部 revision source 下载遵守服务端授权。

- `lib/score/verovio` 拥有 WASM loader、toolkit、MusicXML sanitization 和通用
  page/time lookup；页面不直接操作 toolkit。
- `ScoreRenderer` 拥有 renderer DOM；`ScorePlaybackController` 拥有播放、定位、
  tempo 与事件；`ScoreCursorController` 拥有 cursor 和 auto-scroll。
- `useScorePreviewPlayback` 适配 React UI、requestAnimationFrame 和 ResizeObserver。
  Controller 拥有播放资源与调度；dispose 停止播放并释放 DOM/AudioContext。
- 浏览器音频播放由独立引擎封装；当前 soundfont 资产保证 acoustic piano，
  其它 program 回退到 piano，产品不宣称完整乐器保真。

Score 工作区使用 `/score/:id`、`/score/:id/edit`、`/score/:id/practice`。
Score 编辑读取 canonical revision source 并保存新 revision；Score-specific adapter 位于
`features/scores/core/editor`，保存返回 canonical Score detail，不接受自定义 returnUrl。
`EditorWorkspacePage` 组合共享编辑器 UI，source hook 返回
`EditorWorkspaceDocument`。编辑文档 hook 拥有 query、草稿恢复、校验、
base-revision save target、autosave 与原图 cleanup。

OCR Review 是 job-scoped pipeline。`/imports/:jobId/review` 通过
`features/imports/review/use-review-page-data` 读取数据；`/imports/:jobId/review/edit` 保存临时 job artifact。
确认后导航到 Score。Review 的临时产物与 Score revision assets 分属不同契约。
上传提交与轮询使用 jobs API、job_id 和对应 query keys。

分享入口组合 auth/access、权限操作、允许的下载和可取消图片请求。
`/share/[shareId]` 可在 auth 初始化后匿名加载授权数据，具体动作受服务端
capability 控制。Review 校验、确认、对比图和 carousel 也由专属 hook/component
拥有，页面只组合这些接口。

## Practice

Practice execution is browser-local. 后端提供 canonical score/source/artifact 和
模型资产；所需资产加载后，当前 session 的执行不依赖持续网络连接。

- `score/`：admitted artifact、piano-key、meter 与 exact score-time。
- `planning/`：PracticeIntent 到 immutable PracticePlan 的纯解析，拥有 scope、tempo、resources、metronome 和 count-in policy。
- `session/`：Start 后 local execution identity、PracticePlan 引用与 runtime timebase。
- `step/domain/`：STEP attempt、verdict、progression 和 STEP snapshot。
- `continuous/domain/`：performance clock、session 和 evaluation/finalized ledger。
- `continuous/input/`：MIDI evidence identity、coverage 和 completion publication。
- `score-view/`：renderer-facing cursor scope 与 note-ID projection。
- `step/`：`StepPracticeController`、MIDI/microphone attempt 和资源生命周期。
- `continuous/`：`ContinuousPracticeController`、transport/input/recording 的
  应用生命周期和 completion transaction。
- `acoustic/{model,source,runtime}/`：共享 score-blind 模型、PCM capture 和 source
  observations；`acoustic/continuous/` 投影 performance coordinates。
- Practice viewer、Verovio adapter、playhead 和 scroll controller 拥有渲染与高亮；
  页面和 hook 只订阅快照、发送命令并组合 UI。

STEP_BY_STEP 是 one target / one bounded attempt / one verdict。Domain 独占
MATCH/MISMATCH/RETRY 判定和 target progression。MIDI 以固定 35ms gesture
组装输入，microphone 以 H50 组装 source observations。Physical capture boundary
决定 retirement，busy evidence 不跨 target。STEP 等待输入，没有 Pause/Resume。

CONTINUOUS_PLAY 由 fixed-tempo `PerformanceClockRuntime` 推进，拥有 count-in、
pause/resume 和 captured-time mapping。MIDI/acoustic evidence 只影响 downstream
correctness/timing，不改变 clock、tempo、playhead 或 scope。Live feedback 和 Review
消费同一份 immutable finalized truth；completion 只 drain 未完成尾部工作。

两种模式都已集成 browser-local microphone analysis。Capability detection
只检查浏览器/runtime prerequisite；设备识别质量、permission UX 和端到端物理
延迟需要单独 qualification。模型接收音频事实，expected score 只进入产品域。
用户 recording 与 analysis PCM 分开拥有，不把 MediaRecorder 输出用作分析源。

Controller 明确拥有 root stream、AudioContext、input、metronome、recorder 与
cleanup；各消费者释放自己的资源，借用 context 不自行关闭。Microphone STEP
在同一 physical boundary 同步执行 domain rearm 和 input arm。Mode/input 切换
与 restart 等待 cleanup 后再创建新 owner。

高亮使用 CSS class，只更新当前和上一批 active nodes；scroll 使用安全视口、
hysteresis 和 visibility threshold，避免每帧跳动。

完整契约见 [Practice Product Contract](../../../docs/architecture/practice-product-contract.md)。

## 质量门禁与维护

类型、lint 和构建错误必须显式解决；不通过 ignoreBuildErrors 或忽略 lint
掩盖问题。常规质量入口：

```powershell
npm run lint
npm run check:i18n-errors
npm run check:dead-code
npm run typecheck
npm run test
npm run build
```

按变更选择行为验证：请求 payload、认证和权限、取消与 cleanup、真实状态转换、
i18n、乐谱渲染和 Practice 输入/时钟/evaluation。测试公开行为与可观察资源释放，
不通过源码字符串、历史名称黑名单或文档原句维护架构。

文档记录当前事实和稳定规则，架构基线见
[Customer Web Architecture Baseline](customer-web_architecture_baseline.md)。
变更能力或 ownership 时同步更新对应文档，不追加日期流水账。
