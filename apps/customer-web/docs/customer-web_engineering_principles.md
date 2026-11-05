# Customer Web Engineering Principles

本文定义 NoteVerse Pro 前端的长期工程准则。页面、领域逻辑、API、类型、
资源生命周期和用户可见文案都应表达当前真实产品能力。

## 领域与页面职责

路由负责参数、权限、页面级状态和 UI 组合。复杂算法、状态机、浏览器资源、
Verovio DOM 操作和 API 数据转换由对应领域模块承担。

- `src/app/[locale]/`：路由、layout、loading/error/not-found 和页面编排。
- `src/components/<domain>/`：领域 UI；`components/ui/`：通用基础组件。
- `src/hooks/<domain>/`：React 状态和交互适配。
- `src/hooks/queries/`：服务端查询、mutation 和缓存失效。
- `src/lib/api/`：统一后端请求边界。
- `src/lib/<domain>/`：可独立测试的领域逻辑与 imperative controller。
- `src/generated/api/`：由后端 OpenAPI 生成的 HTTP DTO。
- `messages/en/`、`messages/zh/`：用户可见文案。

按所有权和生命周期拆分模块。组件根目录只保留跨领域入口；纯逻辑不依赖
页面或 React。高频 DOM 更新留在 controller，避免驱动整棵 React 树重渲染。

## API、类型与服务端状态

所有产品请求通过 `src/lib/api/*` 和统一 `apiClient` 管理认证、错误、base URL
与响应解析。下载、blob、stream 和 signed URL 也使用专用 helper。

HTTP DTO 直接导入生成类型。后端契约变更后运行 `npm run generate:api-types`；
视图模型、表单状态和浏览器内部消息由前端拥有。API helper 返回稳定类型，
页面不猜测字段、不通过 `any` 掩盖契约问题。

- Query key 通过 `src/lib/query-client.ts` 的 `queryKeys` 生成，使用稳定、
  可序列化的 domain/scope/identity；不放 File、函数或临时对象。
- Query function 在 API helper 支持时传递 AbortSignal，取消失效请求。
- Mutation 的领域 hook 拥有 cache update/invalidation。
- 页面拥有当前语境的成功提示；API helper 不发 toast，错误由一层展示。
- 客户端临时状态留在 component、Context 或普通 hook。
- 必需环境变量通过 `src/lib/env.ts` 读取，缺失时显式报错。

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
Score 编辑读取 canonical revision source 并保存新 revision。
`EditorWorkspacePage` 组合共享编辑器 UI，source hook 返回
`EditorWorkspaceDocument`。编辑文档 hook 拥有 query、草稿恢复、校验、
base-revision save target、autosave 与原图 cleanup。

OCR Review 是 job-scoped pipeline。`/review/:jobId` 通过
`use-review-page-data` 读取数据；`/review/:jobId/edit` 保存临时 job artifact。
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
