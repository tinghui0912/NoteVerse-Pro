# 琴悦 PianoJoy · 技术架构文档 v2.0

> 原则：用最小的复杂度支撑当前阶段，用清晰的演进路线应对增长，不为尚不存在的问题设计解决方案
> 修订说明：v2.0 修正了编辑器架构（自建 Score Model + Verovio，而非依赖 OSMD 对象模型），修正了 OSMD 渲染机制的描述

---

## 目录

- 一、架构演进路线总览
- 二、Phase 1：单体优先架构（0 → 1万 MAU）
- 三、Phase 2：垂直拆分架构（1万 → 10万 MAU）
- 四、Phase 3：微服务架构（10万+ MAU）
- 五、技术选型详细说明
- 六、编辑器架构专项说明
- 七、数据架构设计
- 八、安全架构设计
- 九、部署方案详细说明
- 十、基础设施服务引入时机全表
- 十一、监控与可观测性体系
- 十二、关键技术决策记录（ADR）

---

## 一、架构演进路线总览

### 1.1 三阶段演进概览

```
Phase 1                    Phase 2                    Phase 3
单体优先                    垂直拆分                    微服务
0 → 1万 MAU               1万 → 10万 MAU              10万+ MAU
1 → 5 人团队               5 → 15 人团队               15+ 人团队

FastAPI 单体               主服务 + 独立 Worker          独立微服务
+ Celery Worker            + WebSocket 服务              + K8s 编排
+ 基础云服务                + 独立 DB 副本                + RabbitMQ 事件总线
                           + API 网关                    + 链路追踪
```

### 1.2 三阶段对比

| 维度 | Phase 1 | Phase 2 | Phase 3 |
|------|---------|---------|---------|
| 触发条件 | 起步 | MAU > 1万 或 团队 > 5人 | MAU > 10万 或 团队 > 15人 |
| 部署方式 | Docker Compose | Docker Compose + 手动扩容 | K8s 托管集群 |
| 运维负担 | 低 | 中 | 需专职 DevOps |
| 开发效率 | 最高 | 较高 | 中（跨服务协调成本）|
| API 网关 | ❌ | ✅ 引入 | ✅ |
| K8s | ❌ | ❌ 可选 | ✅ 必须 |
| RabbitMQ | ❌ | ❌ | ✅ 引入 |
| 链路追踪 | ❌ | ❌ | ✅ 引入 |

---

## 二、Phase 1：单体优先架构

### 2.1 适用条件

- 团队：1–5 人
- 用户量：0 → 1 万 MAU
- 阶段目标：MVP 上线，验证 Product-Market Fit

### 2.2 整体架构

```
┌──────────────────────────────────────────────────────────────────┐
│  用户浏览器 / 移动端                                               │
└─────────────────────────┬────────────────────────────────────────┘
                          │ HTTPS
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  Vercel（前端）                                                   │
│  Next.js 14 App Router                                          │
│  ├── 营销页（SSR：首页/功能/故事/定价）                            │
│  └── 产品页（CSR：Dashboard/编辑器/练习室）                        │
└─────────────────────────┬───────────────────────────────────────┘
                          │ HTTPS REST + WebSocket
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  ECS 主服务器（Nginx 反向代理）                                    │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  FastAPI 主应用（Python 3.12，Gunicorn + Uvicorn）          │  │
│  │  ├── 用户认证模块（Authlib + JWT RS256）                    │  │
│  │  ├── 乐谱管理模块（元数据 CRUD、分享链接、可见性）             │  │
│  │  ├── 支付模块（Stripe Billing + Webhook）                  │  │
│  │  ├── 社区模块（演奏发布、点赞、评论、Feed）                   │  │
│  │  └── WebSocket 端点（音频流接收、跟谱位置推送）               │  │
│  └───────────────────────────────────────────────────────────┘  │
└──────────┬──────────────────────┬───────────────────────────────┘
           │                      │
           ▼                      ▼
┌──────────────────┐   ┌──────────────────────────────────────────┐
│  PostgreSQL      │   │  Redis                                    │
│  （主数据库）     │   │  ├── Celery Broker（任务队列）             │
│                  │   │  ├── Celery Result Backend（任务结果）     │
│                  │   │  ├── JWT 黑名单（主动失效）                │
│                  │   │  ├── 权限缓存（订阅状态 TTL 5min）         │
│                  │   │  └── Rate Limiting 计数器                 │
└──────────────────┘   └──────────────────────────────────────────┘
           │
           │ 任务投递（Celery）
           ▼
┌─────────────────────────────────────────────────────────────────┐
│  ECS Worker 服务器（Celery Workers）                              │
│  ├── OCR Worker ×N        → 调用 OCR API 识别乐谱图片            │
│  ├── Fingering Worker ×N  → 调用 pianoplayer 生成 AI 指法        │
│  ├── Conversion Worker ×N → 调用 Verovio 转 PNG/PDF/MIDI        │
│  └── Email Worker ×N      → 调用 Resend 发送邮件                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  ECS matchmaker 服务器（独立部署，Phase 1 唯一独立服务）           │
│  FastAPI WebSocket 服务                                          │
│  接收浏览器音频帧 → matchmaker 实时分析 → 推送谱面位置             │
└─────────────────────────────────────────────────────────────────┘

外部服务依赖：
├── OCR API（商业乐谱识别，MVP 阶段）
├── Stripe（支付与订阅）
├── Resend（事务性邮件）
├── S3 / 阿里云 OSS（文件存储）
├── CDN（Cloudflare / 阿里云 CDN）
└── Sentry（前后端错误监控）
```

### 2.3 为什么 matchmaker 在 Phase 1 就独立部署

matchmaker 做实时音频信号处理，是 CPU 密集型任务；FastAPI 主服务处理 HTTP/WebSocket 请求，是 I/O 密集型任务。两种工作负载争抢同一台服务器的 CPU，会导致主服务 API 响应时间不稳定，且 matchmaker 对延迟极敏感（目标端到端延迟 < 100ms），共享资源会直接破坏练习室体验。独立一台服务器部署是 Phase 1 唯一值得的"提前拆分"。

### 2.4 Phase 1 明确不引入的东西

| 不引入的服务 | 原因 |
|------------|------|
| API 网关 | 只有 1 个后端服务，Nginx 反向代理已够，API 网关是多服务场景的产物 |
| K8s | 2–3 台服务器用 Docker Compose 管理，K8s 的运维复杂度纯属浪费 |
| RabbitMQ | Celery + Redis 满足所有异步任务，RabbitMQ 的跨服务路由此阶段无用武之地 |
| 服务注册与发现 | 服务少，环境变量配置地址即可，无动态发现需求 |
| 配置中心 | 环境变量 + .env 文件，通过 GitHub Actions Secrets 注入，够用 |
| 密钥管理（Vault）| 小团队环境变量即可，Vault 的价值在 10 人以上团队才体现 |
| ELK 日志收集 | 结构化 JSON 日志写 stdout，云服务器自带日志管理，Sentry 收集错误，够用 |
| Elasticsearch | PostgreSQL tsvector 全文搜索对百万级以下数据性能足够 |

---

## 三、Phase 2：垂直拆分架构

### 3.1 触发条件（满足任意一条启动改造）

- MAU 稳定超过 1 万
- 团队超过 5 人，出现多个功能模块并行开发
- OCR Worker 与主服务的资源竞争开始影响 API P99 响应时间（超过 1 秒）
- 练习室并发 WebSocket 连接超过 500 个
- 数据库读写互相影响，出现慢查询积压

### 3.2 Phase 2 架构变化

在 Phase 1 基础上做三件独立的事，可以按需逐步推进，不必同时完成：

**变化一：新增 API 网关（APISIX）**

```
用户请求
   ↓
API 网关（APISIX）
├── JWT 验证（卸载到网关，主服务不再重复验证）
├── Rate Limiting（统一配置所有接口限流规则）
├── 路由分发（/api/* → 主服务，/realtime/* → 实时服务）
└── 请求日志（所有入口流量集中记录）
   ↓
后端服务（主服务 / 实时服务）
```

引入原因：服务超过 2 个后，需要一个统一入口处理横切面关注点（鉴权、限流、路由），避免每个服务各自实现导致不一致。Phase 1 不引入是因为只有 1 个后端服务，Nginx 完全够用。

**变化二：实时服务完全独立**

WebSocket 服务（matchmaker + 编辑器协作）从主服务完全分离，独立部署和扩容。独立的原因已在 Phase 1 说明，Phase 2 正式独立成一个服务边界。

**变化三：PostgreSQL 读写分离**

```
写操作（INSERT/UPDATE/DELETE）→ 主库（Primary）
读操作（SELECT）→ 只读副本（Replica × 1–2）
连接池 → PgBouncer（减少短连接开销）
```

引入原因：社区 Feed 查询、乐谱库浏览等读操作量远大于写操作，添加只读副本分流查询，减轻主库压力，同时 PgBouncer 避免大量短连接冲击数据库。

### 3.3 Phase 2 仍然不引入的东西

| 不引入 | 原因 |
|--------|------|
| K8s | 3–5 个服务用 Docker Compose + 手动水平扩展完全可行，K8s 的弹性伸缩收益不足以覆盖其运维成本 |
| RabbitMQ | 服务间通信通过 REST API（同步）或 Celery 任务（异步）完成，无跨服务事件广播需求 |
| 配置中心 | 服务数量仍少，环境变量管理可行，等引入 K8s 后用 ConfigMap 一并解决 |

---

## 四、Phase 3：微服务架构

### 4.1 触发条件（同时满足多条才迁移）

- MAU 稳定超过 10 万
- 团队超过 15 人，不同模块由独立小组开发和部署
- 出现某个模块故障影响完全无关模块（这是最强的拆分信号）
- 单个模块需要独立的技术栈或扩容策略
- 数据库成为单点瓶颈，需要按业务域拆分

### 4.2 服务拆分方案

按业务域（Domain）拆分，每个服务拥有自己的数据库。错误的拆分方式是按技术层拆分（"所有 API 一个服务"、"所有 DB 操作一个服务"），这只是制造了一个分布式单体。

```
API 网关（APISIX）
      │
  ┌───┼───────────────────────────────────────────┐
  ▼   ▼           ▼           ▼          ▼        ▼
用户  乐谱        练习         社区       支付      文件
服务  服务        服务         服务       服务      服务
 │    │           │            │          │         │
用户  乐谱        练习          社区      支付      （无独立
 DB   DB          DB            DB         DB        DB，
                                                   依赖 S3）

独立基础服务：
├── 通知服务（邮件/推送/站内通知统一处理）
└── 实时服务（WebSocket + matchmaker + 协作）
```

**各服务职责边界：**

用户服务：注册/登录/OAuth、JWT 签发、用户资料、权限与订阅状态存储。其他服务需要校验用户权限时，通过 API 网关的 JWT 验证或调用用户服务内部 API。

乐谱服务：乐谱元数据 CRUD、上传触发（通知文件服务）、分享链接管理、乐谱可见性控制、目录管理。

练习服务：练习记录、演奏结果存储、AI 点评触发、成就系统、历史统计。

社区服务：演奏发布、点赞、评论、关注关系、Feed 流生成（Redis Fan-out 推送）。

支付服务：Stripe 集成、订阅状态管理、账单记录、权益校验接口（其他服务查询用户权限时调用）。

文件服务：文件上传接收、OCR 任务投递、Verovio 格式转换（PNG/PDF/MIDI）、S3 文件管理、CDN URL 生成。

通知服务：接收来自其他服务的通知事件，统一处理邮件（Resend）、站内通知、推送通知。不拥有业务数据，只负责消息的派发和记录。

实时服务：WebSocket 长连接管理、matchmaker 实时跟谱、编辑器实时协作（v1.2）。

### 4.3 Phase 3 新增的基础设施

**K8s（Kubernetes）**

引入时机：独立部署的服务超过 8 个，且有弹性扩缩容需求（如 OCR Worker 在高峰期需要快速扩容）。

引入原因：服务数量超过 8 个后，手动管理每个服务的部署、扩缩容、健康检查、服务发现变得不可行。K8s 解决的核心问题：按服务独立弹性伸缩（OCR 高峰期扩 Worker Pod，低谷期缩回）；服务健康检查和自动重启；滚动发布（Rolling Update）；资源隔离（每个服务的 CPU/内存限额）。

部署建议：使用云服务商托管 K8s（阿里云 ACK 或 AWS EKS），不自建 Master 节点。自建 K8s Master 的运维成本极高，对非基础设施公司没有必要。

---

**RabbitMQ（跨服务事件总线）**

引入时机：微服务架构成型后，出现需要一个事件同时通知多个服务的场景。

引入原因：微服务架构下，"用户完成订阅"这个事件需要同时通知多个服务——通知服务（发欢迎邮件）、练习服务（解锁功能）、数据分析服务（记录转化）。如果用 REST API 同步调用，支付服务需要知道所有下游服务的地址，耦合严重；如果某个下游服务宕机，整个调用链失败。RabbitMQ 的 Fanout Exchange 把一条消息同时投递给多个队列，各服务独立消费，互不影响，下游服务宕机后恢复时自动消费积压消息。

与 Celery + Redis 的关系：两者并存，职责不重叠。Celery + Redis 处理**服务内部**的后台任务（如乐谱服务内的文件转换）；RabbitMQ 处理**跨服务**的事件通知（如订阅成功事件广播给多个服务）。

需要走 RabbitMQ 的典型事件：
- `user.subscribed` → 通知服务（邮件）、练习服务（解锁）
- `score.ocr_completed` → 乐谱服务（更新状态）、通知服务（通知用户）
- `performance.published` → 社区服务（入 Feed）、练习服务（更新成就）
- `payment.failed` → 通知服务（邮件告警）、用户服务（标记欠费状态）

---

**服务注册与发现（K8s Service 内置，无需独立部署 Consul/etcd）**

引入时机：K8s 引入时自动获得。

K8s 的 CoreDNS 为每个 Service 提供稳定的 DNS 名称（如 `score-service.default.svc.cluster.local`），服务间通过 DNS 互相发现，无需额外部署 Consul 或 etcd。只有在非 K8s 环境下有多个服务需要动态发现的场景，才需要独立部署 Consul。

---

**配置中心（K8s ConfigMap + Secret）**

引入时机：K8s 引入时自动获得基础能力。

K8s ConfigMap 存储非敏感配置（功能开关、外部服务地址等），K8s Secret 存储敏感配置（数据库密码、API Key）。如果需要**配置热更新**（修改配置不重启服务），额外引入 Nacos 或 Apollo。绝大多数配置变更允许服务重启，热更新不是普遍需求，不建议默认引入。

---

**密钥管理（HashiCorp Vault 或云 KMS）**

引入时机：团队超过 10 人，或有安全审计/合规要求，或需要密钥定期自动轮转时。

Phase 1/2 方案（已足够）：密钥存环境变量，通过 CI/CD 系统（GitHub Actions Secrets）注入，不写入代码仓库。Phase 3 引入 Vault 提供动态密钥（每次请求的数据库密码都不同，定期自动轮转），大幅降低密钥泄露的爆炸半径。或使用云服务商 KMS，与 K8s Secret 集成更简单。

---

**分布式链路追踪（OpenTelemetry + Jaeger）**

引入时机：Phase 3，服务超过 5 个，排查一个请求需要追踪跨多个服务的调用链路时。

Phase 1/2 不引入的原因：Sentry 错误追踪 + 结构化日志里的 `request_id` 字段，已经足够排查单体或 2–3 个服务的问题。每条日志带同一个 `request_id`，通过日志系统过滤即可还原完整请求链路，不需要专用链路追踪工具。Phase 3 用 OpenTelemetry Python SDK 自动生成跨服务 trace，Jaeger 做存储和可视化。

---

**搜索引擎（Elasticsearch）**

引入时机：乐谱库超过 100 万份，或 PostgreSQL 全文搜索延迟超过 500ms 时。

PostgreSQL tsvector 全文搜索在百万级以下数据量性能完全足够。Elasticsearch 的运维成本（集群管理、数据同步双写、索引维护）在早期完全不值得引入。

---

**服务网格（Istio / Linkerd）**

引入时机：团队超过 30 人，有统一管理服务间 mTLS 加密、流量熔断需求，或有金融级安全合规要求时。绝大多数产品不需要引入，它会显著增加运维复杂度。对于琴悦，不建议引入。

---

## 五、技术选型详细说明

### 5.1 前端

**Next.js 14（App Router）**

营销页面（首页、功能介绍、用户故事）使用 SSR，保证搜索引擎可以索引。产品内页面（Dashboard、编辑器、练习室）使用 CSR，避免服务端渲染产品状态的不必要开销。App Router 允许同一代码库里按路由选择渲染策略，不需要两个独立项目。部署在 Vercel，对 Next.js 原生支持，零配置，全球 CDN 自动处理静态资源。

**OpenSheetMusicDisplay（OSMD）**

仅用于编辑器场景，作为 Score Model（自建，见第六章）的渲染层之一。OSMD 的核心价值不是"增量渲染"（这个说法不准确），而是它提供了一个**运行时对象树**（MusicSheet → Measures → Notes），可以作为编辑操作的操控目标。但修改对象后仍然需要调用 `osmd.render()` 重新执行布局流程，这与 Verovio 的差别在于：OSMD 的对象树是编辑器状态管理的操控点，而非渲染效率的来源。详见第六章。

**Verovio（JavaScript WASM 版）**

用于乐谱阅读器场景（乐谱详情页播放预览、练习室光标同步）以及编辑器的高质量渲染备选方案。

核心 API：
- `getElementsAtTime(ms)`：输入毫秒时间戳，返回该时刻演奏的 SVG 元素 ID，用于音符高亮
- `renderToMIDI()`：生成 MIDI 数据供 Tone.js 播放
- 内置 timemap：每个音符的毫秒时间戳与 SVG 元素 ID 的映射，是播放同步的完整基础

Verovio 的雕刻质量高于 OSMD，适合阅读场景；其缺点是每次修改都需要重新 `loadData()` + `renderToSVG()`，不适合高频编辑交互（需要配合防抖处理）。通过 NPM 包（verovio/wasm）引入，支持 Webpack/Vite 构建。使用 Verovio 可以完全避免购买 OSMD 付费的官方 Audio Player。

**Tone.js**

配合 Verovio 的 timemap 和 `renderToMIDI()` 做音频调度和钢琴音色播放。

核心价值：Transport 系统提供音乐时间单位（小节/拍）的精确事件调度，比直接使用 Web Audio API 的秒数计算更可靠；Sampler 通过音高移位从少量采样点合成完整 88 键钢琴音色；Tone.Draw 确保音频时钟与视觉更新（requestAnimationFrame）同步，解决两者时钟不一致问题。

练习室场景中，Tone.js 不驱动光标（由 matchmaker 服务端推送驱动），但提供按键音效反馈（用户弹奏时的实时钢琴声）。

**原生 WebSocket API**

浏览器内置标准，零额外依赖，与 FastAPI 原生 WebSocket 协议完全兼容。

不使用 Socket.IO 的原因：Socket.IO 使用自定义帧格式，与 FastAPI 原生 WebSocket 不兼容（若前端用 socket.io-client，后端必须引入 python-socketio 增加依赖）；Socket.IO 客户端增加 200KB+ bundle；其核心附加值（自动降级到长轮询）对消费类音乐应用无实际价值（目标用户均使用现代浏览器）；自动重连可以用十几行代码自己实现。

**Tailwind CSS**

与 Next.js 深度集成，JIT 模式按需生成 CSS。Design Token（颜色、间距、圆角）直接在 tailwind.config.js 里定义，保证 Design System 的一致性。

### 5.2 后端

**FastAPI（Python 3.12）**

选择 Python 统一后端的根本原因：matchmaker（实时跟谱，Python 3.12 专属）和 pianoplayer（AI 指法）都是纯 Python 库，统一 Python 后端可以在同一进程里直接调用这些库，避免跨语言 RPC 的网络延迟——对 matchmaker 的实时音频处理（延迟敏感）尤其关键。

FastAPI 的附加价值：原生 async/await 支持（asyncio + Uvicorn，高并发性能好）；Pydantic v2 数据验证；FastAPI 自动生成 OpenAPI 文档（省去手写 API 文档的工作量，文档与代码始终同步）。

**Authlib + python-jose**

Authlib 处理 Google OAuth 2.0 和微信 OAuth 2.0 完整流程（包括 state 参数防 CSRF、回调处理、令牌交换）。

JWT 签名算法选用 **RS256（非对称）** 而非 HS256，原因：RS256 的私钥只在后端持有，公钥可以安全分发给多个服务用于令牌验证——这为 Phase 3 微服务架构做准备，届时多个服务可以持有公钥独立验证令牌，无需每次都调用用户服务。HS256 的密钥需要在所有服务间共享，密钥泄露后所有服务同时受影响。

**Celery + Redis**

处理所有需要异步处理的后台任务。Redis 同时承担两个角色：Celery Broker（接收主服务投递的任务）和 Result Backend（存储任务执行状态，供前端查询任务是否完成）。

四个独立 Queue，允许独立扩缩容：
- `queue: ocr`：高 CPU，独立 Worker 实例，每个 Worker 不超过 2 个并发任务
- `queue: fingering`：高 CPU，独立 Worker 实例
- `queue: conversion`：中 CPU，可与 email Worker 共享
- `queue: email`：I/O 密集，并发数可设较高（16+）

**所有 Celery 任务必须设计为幂等**：Celery 是 at-least-once 投递语义，网络故障时同一任务可能被执行多次，幂等设计确保重复执行不产生副作用（如重复发邮件、重复计费）。

**matchmaker（实时跟谱）**

接收浏览器 AudioWorklet 捕获的音频帧（PCM 16-bit，每帧 10–20ms），通过 WebSocket 持续接收，matchmaker 的 `matcher.run()` 生成器接口逐帧处理，实时输出当前演奏到乐谱哪个位置的时间戳，服务端通过 WebSocket 推送给前端。

前端收到位置信息后，调用 Verovio 的 `getElementsAtTime()` 高亮对应 SVG 音符节点，调用 Tone.js Sampler 发出按键音效。

延迟控制策略：浏览器用 AudioWorklet 而非 MediaRecorder 捕获音频（延迟低 50–100ms）；WebSocket 长连接而非 HTTP 轮询；前端做延迟补偿（根据实测 RTT 提前预测光标位置）。

**pianoplayer（AI 指法）**

作为 Celery fingering Queue 的 Worker 运行。输入：MusicXML 文件（从 S3 下载）；处理：根据音符音高位置和人体工学模型计算推荐指法；输出：带指法标注的 MusicXML，写回 S3 并更新数据库状态。任务完成后通过 WebSocket 通知前端刷新指法显示。

**Verovio（Python Binding）**

服务端文件转换的核心，在 Celery Conversion Worker 里调用。

- PNG 转换：`MusicXML → verovio.renderToSVG() → cairosvg.svg2png()` → 上传 S3
- PDF 转换：`MusicXML → verovio.renderToSVG() → WeasyPrint` → 上传 S3
- MIDI 转换：`MusicXML → verovio.renderToMIDI()` → Base64 解码 → 上传 S3

Verovio 通过 Python binding 在无头容器中运行，不引入桌面应用和虚拟显示服务器依赖。

如果未来用户对 PDF 排版质量有明确投诉，可通过 `ScoreRenderEngine` 接入其他无头渲染器并进行端到端评测。

### 5.3 数据存储

**PostgreSQL（主数据库）**

存储所有结构化业务数据。支持 JSONB 字段（存储乐谱元数据、AI 点评结果等半结构化数据），tsvector 全文搜索（百万级以下乐谱搜索无需 Elasticsearch），ACID 事务（支付操作一致性保证）。使用 SQLAlchemy 异步引擎（async SQLAlchemy + asyncpg），避免数据库 I/O 阻塞 FastAPI 事件循环。

使用云托管版（Supabase 或阿里云 RDS for PostgreSQL），不自建。托管版自带自动备份、高可用、监控，自建的运维成本对早期团队不值得。

**Redis**

承担多个职责（已在架构图中列出）：JWT 黑名单（实现令牌主动失效，纯 JWT 的无状态特性无法做到）；用户权限缓存（Stripe 订阅状态，TTL 5 分钟，避免鉴权时频繁查库）；Celery Broker 和 Result Backend；Rate Limiting 计数器。

使用 Upstash（Serverless Redis，按请求计费，适合早期）或阿里云 Redis 托管版。

**S3 / 阿里云 OSS（对象存储）**

所有文件存储（原始上传图片、MusicXML、PNG 缩略图、PDF、MIDI、演奏录音、用户头像）。

S3 路径规范（文件 URL 在数据库里存路径而非完整 URL，避免域名变更后批量更新）：
```
/scores/{user_id}/{score_id}/
  original/     ← 原始上传图片（不可变）
  musicxml/     ← 识别生成的 MusicXML
  thumbnails/   ← Verovio 生成的 PNG 缩略图
  exports/      ← 用户下载的 PDF / MIDI
/performances/{user_id}/{performance_id}/
  audio.mp3     ← 演奏录音
/avatars/{user_id}/avatar.jpg
```

预签名 URL 策略：用户上传时生成预签名 Upload URL（有效期 15 分钟），文件从浏览器直传 S3，不经过后端服务器，节省服务器带宽；用户下载时生成预签名 Download URL（有效期 1 小时），不暴露 S3 存储桶直接访问。

**CDN（从 Phase 1 就必须接入）**

CDN 是唯一一个"从一开始就必须用"的基础设施，不是规模化后才需要的优化。原因：Tone.js 使用的 Soundfont 音色文件 30–100MB，没有 CDN 则练习室首次加载极慢；乐谱缩略图大量并发请求会消耗服务器带宽。国内用阿里云 CDN（配合 OSS），国际用 Cloudflare。

### 5.4 第三方服务

**Stripe**

使用 Stripe Billing 管理订阅生命周期，Stripe Customer Portal 让用户自助管理账单。

Webhook 处理两个核心要求：验证请求签名（使用 `stripe.webhook.construct_event()` 验证 Stripe-Signature 头，防伪造）；所有事件处理必须幂等（Stripe 可能重复投递同一事件）。

关键事件：`customer.subscription.created`、`customer.subscription.updated`、`customer.subscription.deleted`、`invoice.payment_failed`。

前端使用 Stripe Elements 托管卡号输入组件，卡号数据从浏览器直接发 Stripe，永远不经过自己的服务器，满足 PCI DSS SAQ A 最低合规级别。

**Resend（邮件）**

专为开发者设计，Python SDK，免费额度 3000 封/月（早期足够），送达率有保障。邮件模板用 React Email 编写，生成 HTML 后传给 Resend。所有邮件通过 Celery email Queue 异步发送，失败重试最多 3 次（指数退避：1s → 2s → 4s）。

**Sentry（错误监控）**

前端（Next.js SDK）和后端（Python SDK）全部接入。前端捕获 JS 异常、接口报错、Core Web Vitals；后端捕获未处理异常、慢请求（超 2 秒自动上报）、Celery 任务失败。

告警规则：新的 Error 类型出现时立即通知；同一错误频率超过阈值（每小时 100 次以上）时通知。

**OCR 服务**

Phase 1：接入商业乐谱识别 API，通过 Celery OCR Worker 异步调用，超时 60 秒，失败重试 3 次。商业 API 用于快速验证用户需求，同时积累真实乐谱样本，为后续自建评估提供依据。

Phase 2 评估：持续以真实上传样本比较候选 OMR 引擎的准确率、结构有效率、延迟和运维成本；通过 `OMREngine` 适配器接入达到验收门槛的实现。
---

## 六、编辑器架构专项说明

### 6.1 设计背景与问题

乐谱编辑器是整个产品技术复杂度最高的模块，需要在架构层面单独说明。核心挑战有三个：

一是**渲染与编辑的解耦问题**：渲染引擎（OSMD/Verovio）是为展示乐谱设计的，不是为编辑操作设计的。把渲染引擎的内部数据结构作为编辑器的状态，会导致编辑逻辑和渲染逻辑深度耦合，很难测试、难以扩展。

二是**每次修改需要重新布局的问题**：无论是 OSMD 还是 Verovio，修改一个音符后都需要重新执行排版（Layout）流程，因为音符时值变化可能引发小节宽度变化、换行变化、后续所有系统重排。这不是工程缺陷，是乐谱排版的本质特性。

三是**协作编辑的问题**：Level 1 异步协作（MVP）和 Level 2 实时协作（v1.2）都需要一套清晰的数据模型来表达"谁在什么时候做了什么操作"。

### 6.2 推荐架构：自建最小化 Score Model + Verovio 雕刻

这是现代专业乐谱编辑器（如 Flat.io）的主流架构，编辑层和渲染层完全分离：

```
用户编辑操作（点击、键盘输入）
         ↓
Score Model（自建，前端内存中的数据结构）
├── 维护 Score → Measures → Voices → Notes 的树形结构
├── 处理编辑命令（增/删/改音符、小节操作）
├── 管理 Undo/Redo 历史栈
└── 序列化为 MusicXML 字符串
         ↓
防抖处理（用户停止操作 300ms 后触发）
         ↓
Verovio.loadData(musicXML) + Verovio.renderToSVG()
         ↓
SVG 渲染到编辑器画布
```

### 6.3 Score Model 的具体设计（MVP 最小化版本）

MVP 阶段不追求完整的音乐理论模型，只覆盖支持"修正 OCR 错误"和"基础创作"的核心操作：

```
ScoreModel
├── metadata: { title, composer, timeSignature, keySignature, tempo }
├── measures: Measure[]
│   ├── measure_number: number
│   ├── time_signature: { numerator, denominator }  ← 局部拍号
│   └── voices: Voice[]
│       └── entries: NoteEntry[]
│           ├── type: 'note' | 'rest' | 'chord'
│           ├── duration: 'whole' | 'half' | 'quarter' | 'eighth' | '16th' | '32nd'
│           ├── pitches: Pitch[]    ← 单音或和弦
│           │   ├── step: 'C'|'D'|'E'|'F'|'G'|'A'|'B'
│           │   ├── octave: number
│           │   └── alter: -1 | 0 | 1   ← 降/还原/升号
│           └── fingering?: number   ← 指法标注（AI 生成后写入）
└── undo_stack: EditCommand[]
    └── redo_stack: EditCommand[]
```

MVP 阶段**不在 Score Model 里实现**的内容（后置到 v1.1/v2.0）：连音线/圆滑线、力度标记、速度渐变、踏板标记、装饰音、歌词、多声部大谱（高低音谱同时编辑）。

### 6.4 大谱（Grand Staff）的 MVP 降级方案

钢琴乐谱通常是大谱（高音谱 + 低音谱），MVP 阶段不支持会影响大量真实乐谱。降级方案：

OCR 识别到大谱时，高音谱和低音谱分别保存为两个独立的单声部 MusicXML。用户可以分别编辑，练习时系统合并两个 MusicXML 的 MIDI 轨道播放，视觉上在同一画面显示两行谱（通过 Verovio 的 Part 渲染实现）。

Review 页和 Editor 页顶部显示提示 Banner：「这份乐谱包含高低音谱，目前分开显示和编辑，练习时会自动合并为完整钢琴谱」。大谱完整编辑支持列为 v1.1 最高优先级功能。

### 6.5 Undo/Redo 设计

使用 Command Pattern。每个编辑操作封装为一个 EditCommand 对象：

```
EditCommand
├── execute(): void    ← 执行操作，修改 Score Model
├── undo(): void       ← 撤销操作，恢复修改前的状态
└── description: string  ← 操作描述，显示在版本历史里
```

Undo 栈：每次执行操作，把命令压入 undo_stack，清空 redo_stack。Redo 栈：每次 Undo，把命令从 undo_stack 弹出压入 redo_stack，再次 Redo 时从 redo_stack 弹出重新执行。MVP 阶段支持至少 50 步历史。

### 6.6 防抖渲染策略

用户连续编辑时，每次修改都重新渲染会导致界面卡顿。防抖策略：

- 用户每次编辑操作立即更新 Score Model（内存操作，毫秒级）
- 设置 300ms 防抖定时器
- 如果 300ms 内有新的编辑操作，重置定时器
- 定时器触发时，将 Score Model 序列化为 MusicXML，调用 Verovio 渲染
- 渲染期间显示轻量"渲染中"指示（不阻塞用户继续编辑）

对于长乐谱，Verovio 支持分页渲染（只渲染当前可见的页面），避免一次渲染整个长卷轴 SVG，可以把渲染时间控制在数百毫秒以内（现代桌面浏览器，标准复杂度钢琴谱）。

### 6.7 协作编辑架构

**Level 1（MVP，异步协作）**

乐谱所有者保存时写入服务器，其他协作者下次打开看到最新版本。冲突处理：Last Write Wins（最后保存者覆盖）。编辑器顶栏显示"最后由 [昵称] 修改于 [时间]"。多人同时在线时，顶部 Banner 提示"其他人也在编辑，建议错开时间操作，以防互相覆盖"。

**Level 2（v1.2，实时协作）**

需要引入实时同步机制。实现方案选型：

Operational Transformation（OT）：Google Docs 使用的方案，对操作做变换以解决冲突，在文本编辑领域成熟，但音乐数据的 OT 实现比文本复杂（音符不是字符流）。

CRDT（Conflict-free Replicated Data Types）：理论上更优雅，但音乐编辑场景的 CRDT 设计复杂，工程代价高。

**建议 v1.2 的简化方案**：不实现完整 OT/CRDT，而是采用"操作广播 + 版本号"方案——每个编辑操作带时间戳和客户端 ID，通过 WebSocket 广播给所有在线协作者，接收方按时间戳顺序应用操作，冲突时以服务端版本为准。这不如完整 OT 健壮，但实现成本低得多，对"老师改学生指法"这类低冲突场景已经足够。

---

## 七、数据架构设计

### 7.1 核心数据表设计说明

以下说明各核心表的关键设计决策，不是完整 DDL。

**users 表**

核心字段：`id`（UUID，主键）、`email`（唯一索引）、`nickname`、`avatar_url`、`subscription_status`（枚举：free/premium/pro）、`subscription_end_at`、`stripe_customer_id`、`created_at`。

关键决策：`subscription_status` 冗余存储在 users 表。虽然 Stripe 是权威数据源，但每次鉴权时去 Stripe 查询延迟高（100–500ms）。通过 Celery Worker 监听 Stripe Webhook 事件，异步同步到本地，鉴权时查 Redis 缓存（TTL 5 分钟），缓存未命中时查 users 表（毫秒级），保证鉴权路径延迟可控。

**scores 表（乐谱元数据）**

核心字段：`id`（UUID）、`owner_id`（外键 users）、`title`、`composer`、`original_file_url`、`musicxml_url`、`thumbnail_url`、`visibility`（枚举：private/shared/public，**默认 private**）、`difficulty`（枚举）、`tags`（JSONB）、`ocr_status`（枚举：pending/processing/completed/failed）、`fingering_status`（枚举：none/pending/completed）、`page_count`、`created_at`、`updated_at`。

关键决策：`visibility` 默认 `private`，满足版权合规要求（新上传乐谱仅自己可见，用户主动设置才可分享或公开）。文件 URL 存 S3 路径而非完整 URL，避免域名变更后需要批量更新数据库。

**score_shares 表（分享链接）**

核心字段：`id`（UUID）、`score_id`（外键）、`share_code`（8 位随机字符串，用于 `/s/[code]` 短链）、`permission`（枚举：view/edit）、`expires_at`（可为 NULL 表示永久）、`created_by`、`is_active`（布尔，支持手动停用）。

索引：`share_code` 上建唯一条件索引（`WHERE is_active = true`），分享页面快速查询。

**performances 表（演奏记录）**

核心字段：`id`（UUID）、`user_id`、`score_id`、`audio_url`、`accuracy_pct`、`rhythm_pct`、`completion_pct`、`grade`（枚举：beginner/improving/smooth/excellent/perfect）、`ai_feedback`（JSONB，AI 点评结果，内容结构可灵活扩展）、`duration_sec`、`is_published`（布尔）、`published_at`、`title`、`mood_tags`（JSONB）、`visibility`、`created_at`。

关键决策：`ai_feedback` 用 JSONB 而非多列，AI 点评的 highlights/suggestions/encouragement 结构可能随模型迭代变化，JSONB 不需要每次改模型输出就变更 Schema。

**subscriptions 表**

核心字段：`id`、`user_id`、`stripe_subscription_id`（Stripe 的 `sub_xxx`）、`plan`（枚举：premium/pro）、`status`（枚举：active/canceled/paused/past_due）、`current_period_start`、`current_period_end`、`cancel_at_period_end`（布尔）、`created_at`。

关键决策：即使 Stripe 是权威数据源，本地也要完整存储订阅记录，原因：Webhook 偶尔丢失时本地记录用于对账；审计需要（哪个用户什么时候订了什么方案）。

### 7.2 核心索引设计

| 索引目标 | 索引列 | 类型 |
|---------|-------|------|
| 用户登录（邮箱查询）| `users(email)` | 唯一索引 |
| 乐谱库页面（按用户+时间）| `scores(owner_id, created_at DESC)` | 普通索引 |
| 社区 Feed（已发布+时间）| `performances(is_published, published_at DESC) WHERE is_published = true` | 条件索引 |
| 分享链接查询 | `score_shares(share_code) WHERE is_active = true` | 唯一条件索引 |
| 乐谱全文搜索 | `scores` 上的 GIN 索引，对 `to_tsvector('simple', title || composer)` | GIN 索引 |
| OCR 状态查询（监控卡住的任务）| `scores(ocr_status, updated_at)` | 普通索引 |

### 7.3 数据迁移策略

使用 Alembic（SQLAlchemy 的迁移工具）管理 Schema 变更。每次变更生成迁移文件，staging 环境自动执行，production 环境人工确认后执行。

核心原则：向前兼容（先加新字段，再删旧字段，确保新旧版本代码可以同时运行）；大表 DDL 变更使用 `pg_repack` 或分步操作（`ALTER TABLE ADD COLUMN` 在大表上会锁表）；每次部署前备份数据库，Schema 变更一旦执行不轻易回滚。

---

## 八、安全架构设计

### 8.1 认证与鉴权体系

**JWT 令牌设计**

Access Token：有效期 15 分钟，存储在 HTTP-Only Cookie（防 XSS，JS 无法读取），或 Authorization Header（移动端/API 调用）。Payload 包含：`user_id`、`subscription_status`、`iat`、`exp`。签名算法 RS256（非对称），私钥只在后端，公钥可分发给多个服务独立验证令牌。

Refresh Token：有效期 30 天，存储在 HTTP-Only Cookie，在 Redis 里存储 Token ID（白名单模式）。用户登出或修改密码时，删除 Redis 里对应的 Refresh Token ID，实现主动失效——这是纯 JWT 方案做不到的能力。

**OAuth 2.0 安全**

Google OAuth 和微信 OAuth 均使用 `state` 参数防 CSRF（随机字符串，存 Server-side Session，回调时验证匹配）。OAuth 回调必须使用 HTTPS，回调 URL 在 OAuth 平台白名单里严格配置，不允许通配符。

**权限校验中间件**

FastAPI 的 `Depends` 系统实现依赖注入式权限校验（如 `Depends(require_premium)`）。中间件从 Redis 读取用户权限缓存（TTL 5 分钟），缓存未命中时查数据库并重建缓存。校验结果在同一请求生命周期内缓存，避免同一请求多次查询 Redis。

### 8.2 Stripe 支付安全

Webhook 签名验证：所有 Stripe Webhook 请求使用 `stripe.webhook.construct_event()` 验证 `Stripe-Signature` 头，拒绝签名不匹配的请求。签名密钥存环境变量，不写入代码仓库。

幂等键：所有创建 Stripe 资源的 API 调用（创建订阅、创建支付意图）必须传入幂等键，防止网络重试导致重复收费。

Stripe Elements：前端使用 Stripe.js 托管的卡号输入组件，卡号数据从浏览器直接发到 Stripe，永远不经过自己的服务器，满足 PCI DSS SAQ A 合规级别。

### 8.3 文件上传安全

文件类型校验：服务端验证文件的 Magic Bytes（文件头字节）而非文件扩展名，防止通过改后缀伪造文件类型。允许的 Magic Bytes：JPEG（`FF D8 FF`）、PNG（`89 50 4E 47`）、PDF（`25 50 44 46`）。

S3 存储桶策略：存储桶不开放公开访问（BlockPublicAcls: true），所有文件通过预签名 URL 访问。上传 URL 有效期 15 分钟，下载 URL 有效期 1 小时。

### 8.4 API 安全

Rate Limiting：注册/登录接口同一 IP 每分钟最多 10 次；密码重置同一 IP 每小时最多 5 次；普通 API 同一用户每分钟最多 100 次。Phase 1 在 FastAPI 中间件里用 Redis 计数器实现，Phase 2 迁移到 API 网关统一处理。

SQL 注入防护：全部使用 SQLAlchemy ORM 或参数化查询，绝不拼接 SQL 字符串。

XSS 防护：用户输入存库前 HTML 转义；React JSX 输出时自动转义；富文本内容（Markdown 评论）使用白名单 Sanitizer（bleach 库）清理危险 HTML 标签。

HTTPS 强制：Nginx 配置 301 重定向，所有 HTTP 请求强制跳转 HTTPS。设置 HSTS 头（`Strict-Transport-Security: max-age=31536000`）。

CORS 配置：生产环境 `Access-Control-Allow-Origin` 严格限制为已知前端域名，禁止通配符 `*`。

---

## 九、部署方案详细说明

### 9.1 环境划分

**development（本地开发）**

Docker Compose 启动 PostgreSQL 和 Redis 依赖，FastAPI 和 Celery 直接运行在本地 Python 虚拟环境（非容器），方便调试器断点。OCR 使用 Mock 响应，不调用真实 OCR API，节省费用并加快迭代。Stripe 使用 test mode。

**staging（预发环境）**

与生产环境配置完全一致的镜像，使用较小的服务器实例，独立的数据库实例（数据内容定期从生产环境脱敏后同步）。所有代码合并到 main 分支前必须先在 staging 通过完整集成测试。Stripe 使用 test mode。

**production（生产环境）**

正式生产环境，独立资源，数据库每日自动备份，保留 30 天。Stripe 使用 live mode。所有部署需要人工审批（不允许自动推送到生产）。

### 9.2 Phase 1 服务器配置

**主服务器（FastAPI 主应用）**
- 规格：4 核 8GB（阿里云 ECS c7.xlarge 或同等）
- 系统：Ubuntu 22.04 LTS
- 进程：FastAPI（Gunicorn + 4 个 Uvicorn Worker）、Nginx 反向代理

**Worker 服务器（Celery Workers）**
- OCR Worker：8 核 16GB（CPU 密集），每个 Worker 进程最多 2 个并发任务
- 其他 Worker（fingering/conversion/email）：4 核 8GB，可共用一台

**matchmaker 服务器（实时跟谱）**
- 规格：4 核 8GB，选择与目标用户地理位置最近的机房
- 注意：需要系统依赖 libsndfile、ffmpeg（音频处理库的系统依赖）

**数据库**
- 优先使用云托管 PostgreSQL（Supabase 或阿里云 RDS），不自建
- Redis：Upstash（Serverless，按请求计费）或阿里云 Redis 托管版

### 9.3 Docker Compose 服务组织

```
主服务器运行：
├── service: nginx          ← HTTPS 终止 + 反向代理，端口 80/443
└── service: api            ← FastAPI 主应用，端口 8000（内部）

Worker 服务器运行：
├── service: celery-ocr         ← 消费 ocr Queue，并发数 2
├── service: celery-fingering   ← 消费 fingering Queue，并发数 4
├── service: celery-conversion  ← 消费 conversion Queue，并发数 4
├── service: celery-email       ← 消费 email Queue，并发数 16
└── service: celery-beat        ← 定时任务调度器（练习提醒邮件）

matchmaker 服务器运行：
└── service: realtime       ← matchmaker WebSocket 服务，端口 8001
```

所有 Docker 镜像从同一个 Dockerfile 构建（主应用和 Worker 使用相同代码库，通过启动命令区分），减少维护多个 Dockerfile 的负担。

### 9.4 Nginx 配置要点

- HTTPS 终止：SSL 证书由 Let's Encrypt 免费颁发，Certbot 自动续签（每 90 天）
- HTTP → HTTPS：301 重定向
- `/api/*`：反向代理到 FastAPI 端口 8000
- WebSocket 代理：必须添加 `proxy_http_version 1.1`、`proxy_set_header Upgrade $http_upgrade`、`proxy_set_header Connection "upgrade"`，否则 WebSocket 升级握手失败
- 上传大小限制：`client_max_body_size 25m`（业务限制 20MB，Nginx 稍大避免先报错）

### 9.5 CI/CD 流水线（GitHub Actions）

**Push 到 feature 分支时**
- Python linting（ruff）：检查代码风格
- TypeScript 类型检查（`tsc --noEmit`）
- 单元测试（pytest + Jest）
- 全程应在 5 分钟内完成，否则开发反馈循环过慢

**合并到 main 分支时**
- 构建 Docker 镜像，推送到容器镜像仓库（阿里云 ACR 或 GitHub Container Registry）
- 自动部署到 staging 环境
- 运行集成测试（真实 PostgreSQL + Redis，Stripe test mode）
- 测试通过后，Slack 通知 + 等待人工批准
- 人工批准后，自动部署到 production

**生产部署策略（蓝绿部署）**
- 同时运行新旧两个版本
- 流量切换后观察 5 分钟（监控 Sentry 新增错误、API 响应时间）
- 确认无问题后关闭旧版本
- 通过修改 Nginx upstream 配置切换流量，不需要 K8s 也能实现蓝绿部署

### 9.6 回滚方案

每次部署保留上两个版本的 Docker 镜像 tag。发现问题时，修改 docker-compose.yml 的镜像 tag 为上一版本，执行 `docker compose up -d`，预计回滚时间 < 2 分钟。

数据库 Schema 变更一旦执行不自动回滚（DDL 无法撤销），这是为什么每次 Schema 变更必须向前兼容（先加字段，再删字段），并在部署前备份数据库。

### 9.7 Python 依赖隔离

matchmaker（要求 Python 3.12）、pianoplayer、Verovio、music21 等库依赖复杂，且版本要求严格。每个 Worker 服务类型建议使用独立的 Docker 镜像（各自有独立的 requirements.txt），避免依赖冲突。用 `uv`（Astral 出品的 Python 包管理器，比 pip 快 10-100 倍）管理依赖，加快 CI 构建速度。

---

## 十、基础设施服务引入时机全表

| 基础设施 | Phase 1 | Phase 2 | Phase 3 | 判断依据 |
|---------|---------|---------|---------|---------|
| PostgreSQL | ✅ 必须 | ✅ | ✅ | 核心数据存储，无替代 |
| Redis | ✅ 必须 | ✅ | ✅ | Celery Broker + 缓存，两用 |
| Celery | ✅ 必须 | ✅ | ✅ | Python 异步任务标准方案 |
| S3 / OSS | ✅ 必须 | ✅ | ✅ | 文件存储无替代 |
| CDN | ✅ 必须 | ✅ | ✅ | Soundfont 30-100MB，不用 CDN 练习室无法使用 |
| Sentry | ✅ 必须 | ✅ | ✅ | 最低成本的错误可见性 |
| Resend（邮件）| ✅ 必须 | ✅ | ✅ | 不要用服务器自发邮件（入垃圾箱）|
| Stripe | ✅ 必须 | ✅ | ✅ | 支付核心依赖 |
| API 网关（APISIX）| ❌ | ✅ 引入 | ✅ | 服务数 > 2 时引入，统一鉴权/限流/路由 |
| PgBouncer 连接池 | ❌ | ✅ 引入 | ✅ | 并发连接数 > 100 时引入 |
| PostgreSQL 只读副本 | ❌ | ✅ 引入 | ✅ | 读 QPS > 1000 或出现读写互相影响 |
| Redis Sentinel | ❌ | ✅ 引入 | ✅ | 对 Redis 高可用有要求时 |
| K8s（托管）| ❌ | ❌ 可选 | ✅ 必须 | 独立服务 > 8 个且有弹性伸缩需求 |
| RabbitMQ | ❌ | ❌ | ✅ 引入 | 出现跨服务事件广播需求时 |
| 服务注册发现 | ❌ | ❌ | ✅ K8s 内置 | K8s CoreDNS 自带，无需独立部署 |
| K8s ConfigMap / Secret | ❌ | ❌ | ✅ K8s 内置 | K8s 引入时自动获得 |
| 配置热更新（Nacos）| ❌ | ❌ | ⚠️ 按需 | 仅在有频繁变更且不能重启的配置时引入 |
| 密钥管理（Vault / KMS）| ❌ | ❌ | ⚠️ 按需 | 团队 > 10 人或有安全审计要求时 |
| 链路追踪（Jaeger）| ❌ | ❌ | ✅ 引入 | 服务 > 5 个，排查跨服务请求时 |
| Prometheus + Grafana | ❌（Sentry 够）| ✅ 引入 | ✅ | Phase 2 开始需要业务指标监控 |
| Elasticsearch | ❌ | ❌ | ⚠️ 按需 | 乐谱数 > 100 万或 PG 全文搜索延迟 > 500ms |
| 服务网格（Istio）| ❌ | ❌ | ❌ 大多不需要 | 仅在有金融级安全合规要求时 |

---

## 十一、监控与可观测性体系

### 11.1 三大支柱

**日志（Logs）—— 记录发生了什么**

所有服务输出结构化 JSON 日志，每条日志必须包含：`timestamp`、`level`、`service`（服务名）、`request_id`（串联同一请求的所有日志，在请求入口生成 UUID 并全程传递，包括 Celery 任务日志）、`user_id`（已登录时附带）、`message`。

Python 后端使用 structlog 库，配置 JSON renderer，输出到 stdout。

Phase 1/2：云服务器自带日志管理（阿里云 SLS 或 CloudWatch）。Phase 3：引入 Grafana Loki（轻量）或 ELK（功能全）集中管理。

**指标（Metrics）—— 记录系统状态**

业务指标（代码埋点，暴露为 Prometheus 格式）：
- API 请求量（按路径和 HTTP 状态码分组）
- API P99 响应时间（按路径分组）
- OCR 识别平均耗时和成功率
- Celery 各 Queue 积压长度（监控 Worker 是否够用）
- Stripe 支付成功率
- 活跃 WebSocket 连接数
- 新注册用户数、订阅转化率（每小时统计）

系统指标（Node Exporter 自动采集）：CPU、内存、磁盘 I/O、网络流量、文件描述符数量（WebSocket 连接的关键指标）。

Phase 2 起引入 Prometheus + Grafana Cloud（优先使用托管版，避免自建运维负担）。

**链路追踪（Traces）—— 记录请求路径**

Phase 1/2：通过日志里的 `request_id` 手动关联日志实现类似效果，不需要专用链路追踪工具。Phase 3 引入 OpenTelemetry Python SDK（自动生成跨服务 trace）+ Jaeger（存储和可视化）。

### 11.2 告警策略分级

告警分级避免告警疲劳（所有告警同级别会导致所有告警被忽略）：

**P0（立即响应，任何时间通知 On-call，电话/短信）**
- 生产环境 API 错误率超过 5%，持续 3 分钟
- 支付接口失败率超过 1%
- 服务器内存超过 95% 或 CPU 超过 95%，持续 5 分钟
- 数据库连接池耗尽
- 主服务进程宕机（探活失败）

**P1（1 小时内响应，发送到 Slack 通知群组）**
- OCR 任务队列积压超过 100 条（用户等待过长）
- Celery Worker 全部宕机（所有异步任务停止）
- API P99 响应时间超过 3 秒，持续 5 分钟
- 磁盘使用率超过 80%

**P2（工作时间内处理，每日汇总）**
- Sentry 出现新的 Error 类型
- 邮件发送失败率超过 5%
- Celery 任务重试次数超过阈值

### 11.3 健康检查设计

每个服务提供两个端点：

`GET /health/live`（浅层）：只检查进程是否存活，返回 200 即可，超时 2 秒，失败则重启服务。K8s Liveness Probe 使用。

`GET /health/ready`（深层）：检查关键依赖是否可用（PostgreSQL 连接、Redis 连接），失败则从负载均衡摘除流量（不重启进程）。K8s Readiness Probe 使用。深层检查不应因外部依赖（Stripe API、Resend）短暂超时而失败，只检查本地关键依赖。

---

## 十二、关键技术决策记录（ADR）

ADR（Architecture Decision Record）记录重要架构决策，包含背景、考虑的方案、最终选择和理由。目的：让 6 个月后加入的新成员理解架构的来龙去脉，而不必从头猜测。

---

**ADR-001：后端统一采用 FastAPI（Python 3.12）**

背景：前端选 Next.js（Node.js 生态）。如果后端也选 Node.js，技术栈统一，减少上下文切换。但核心 Python 库（matchmaker 实时跟谱、pianoplayer AI 指法）没有 Node.js 等价物。

选择 FastAPI（Python），理由：统一 Python 后端可以在同一进程里直接调用这两个库，避免跨语言 RPC 的网络延迟——对 matchmaker 的实时音频处理（目标端到端 < 100ms）尤其关键；Python 在 ML/音频处理领域的生态比 Node.js 更丰富，未来扩展 AI 功能更自然；FastAPI（asyncio + Uvicorn）性能足以支撑预期流量。

---

**ADR-002：编辑器采用自建 Score Model + Verovio 雕刻，而非直接使用 OSMD 对象模型**

背景：早期方案计划直接使用 OSMD 的内部对象模型作为编辑器的数据层。经过深入评估发现这个方案存在问题。

问题一：OSMD 并不是增量渲染引擎。修改一个音符后，仍然需要调用 `osmd.render()` 重新执行布局流程（小节宽度变化可能引发换行变化和后续系统重排），与 Verovio 的差别并不在渲染效率，而在于 OSMD 维护了一个可操控的运行时对象树。

问题二：深度依赖 OSMD 内部对象结构会使编辑器逻辑与渲染引擎紧耦合，更换渲染引擎（如未来迁移到 Verovio）成本极高。

问题三：行业主流方案（如 Flat.io）已验证了"自建数据模型 + Verovio 雕刻"的可行性，雕刻质量更高，长期扩展性更好。

选择自建最小化 Score Model + Verovio 雕刻。代价是 MVP 阶段需要额外 2–4 周实现 Score Model，但这是必要的工程基础，不可绕过。防抖渲染（300ms）解决高频编辑的性能问题。

---

**ADR-003：服务端文件转换使用 Verovio（Python Binding）**

背景：需要在服务端把 MusicXML 转换为 PNG、PDF、MIDI。

选择 Verovio，理由是 Python binding 可直接在无头容器中运行，不需要桌面运行时，并能输出适合前端和存储链路的 SVG 页面。

若未来需要替换，通过 `ScoreRenderEngine` 增加候选实现，不在业务流程中引入渲染器专用分支。

---

**ADR-004：乐谱阅读器（详情页/练习室）使用 Verovio，不购买 OSMD 官方 Audio Player**

背景：乐谱详情页需要播放预览（音符随播放高亮），练习室需要 matchmaker 驱动的实时光标跟随。最简单的方案是购买 OSMD 官方 Audio Player（付费，提供播放+光标同步开箱即用）。

选择 Verovio，理由：Verovio 的 `getElementsAtTime(ms)` API 天然适合播放同步场景——输入毫秒时间戳，输出对应 SVG 元素 ID，直接用于音符高亮；内置 `renderToMIDI()` 配合 Tone.js 播放，完整支持播放预览场景；在练习室场景中，matchmaker 推送位置信息，前端调用 `getElementsAtTime()` 高亮，逻辑同样简洁。OSMD 官方 Audio Player 需要持续付费订阅，且功能绑定 OSMD，使用 Verovio 完全替代其功能且无费用。

---

**ADR-005：不使用 Socket.IO，使用原生 WebSocket**

背景：练习室跟谱和编辑器协作都需要 WebSocket，Socket.IO 是最常见的封装库。

选择原生 WebSocket，理由：Socket.IO 使用自定义帧格式，与 FastAPI 原生 WebSocket 不兼容（前端用 socket.io-client 则后端必须引入 python-socketio，增加不必要依赖）；Socket.IO 客户端增加 200KB+ bundle；其核心附加值（自动降级到长轮询）对消费类音乐应用无实际价值；自动重连可以用十几行代码自己实现。

---

**ADR-006：任务队列使用 Celery + Redis，不使用 BullMQ 或 RabbitMQ**

背景：需要为 OCR 识别、AI 指法生成、文件转换、邮件发送选择异步任务方案。

放弃 BullMQ：BullMQ 是 Node.js 库，后端确定为 Python，直接排除。

放弃 RabbitMQ（Phase 1/2 阶段）：项目所有异步任务类型简单（无跨服务路由），Celery + Redis 满足需求，Redis 本来就需要（缓存），不增加额外基础设施。RabbitMQ 在 Phase 3 微服务阶段引入，届时职责是跨服务事件总线，与 Celery + Redis 的任务队列职责不重叠。

---

**ADR-007：Phase 1 不引入 K8s，采用 Docker Compose**

背景：K8s 是行业标准，是否从起步就使用以避免未来迁移成本。

选择 Docker Compose（Phase 1/2），理由：K8s 的运维复杂度（学习曲线、集群管理、网络配置）在服务数 < 8 个时只会消耗工程师时间，不产生对应收益；MVP 阶段工程资源应该聚焦产品功能而非基础设施；Docker Compose 到 K8s 的迁移路径清晰（每个 service 对应一个 Deployment），迁移代价远低于"过早引入 K8s 降低开发速度"的代价。使用云托管 K8s（ACK/EKS），不自建 Master 节点。

---

*文档结束*

*琴悦 PianoJoy 技术架构文档 v2.0*
*演进路线：Phase 1 单体（0→1万MAU）→ Phase 2 垂直拆分（1万→10万MAU）→ Phase 3 微服务（10万+MAU）*
*12 个章节，7 条 ADR，覆盖：演进路线 / 三阶段架构 / 技术选型 / 编辑器架构 / 数据架构 / 安全架构 / 部署方案 / 基础设施引入时机 / 监控体系 / 关键决策记录*

---

## 附录 A · 实时服务详细架构

### A.1 练习室音频流处理全链路

```
浏览器端（前端）
┌──────────────────────────────────────────────────────┐
│  麦克风 / MIDI 键盘                                    │
│       ↓                                              │
│  AudioWorklet（Web Audio API 现代方案）               │
│  ├── 捕获原始 PCM 音频帧（每帧 10–20ms）               │
│  ├── 编码为 PCM 16-bit Little-Endian                  │
│  └── 通过 WebSocket 持续推送到服务端                   │
│                                                      │
│  同时接收服务端推送的位置信息：                         │
│  ├── Verovio.getElementsAtTime(ts) → 高亮 SVG 音符    │
│  └── Tone.js Sampler → 播放对应按键音效               │
└──────────────────────────────────────────────────────┘
         │ WebSocket（二进制帧）
         ▼
服务端（matchmaker 服务）
┌──────────────────────────────────────────────────────┐
│  FastAPI WebSocket 端点                               │
│       ↓                                              │
│  matchmaker Matcher 实例（每个练习会话独立一个实例）    │
│  ├── 接收音频帧，送入 matcher.run() 生成器              │
│  ├── 实时输出 (timestamp_ms, score_position) 元组      │
│  └── 通过 WebSocket 推送回前端                         │
└──────────────────────────────────────────────────────┘
```

**延迟预算分析：**

| 环节 | 预计延迟 | 说明 |
|------|---------|------|
| AudioWorklet 分帧 | 10–20ms | 帧长度，比 MediaRecorder 低 50-100ms |
| WebSocket 传输（国内）| 20–50ms | 取决于用户到服务器的地理距离 |
| matchmaker 处理 | 5–15ms | CPU 密集，独立服务器保障 |
| 结果 WebSocket 回传 | 20–50ms | 同传输延迟 |
| 前端高亮渲染 | < 5ms | SVG DOM 操作 |
| **端到端合计** | **55–140ms** | 目标 < 150ms，可接受 |

前端延迟补偿：根据实测 RTT，在显示光标时提前若干毫秒，让视觉位置略微超前于实际分析位置，改善用户感知流畅度。

### A.2 编辑器 Level 1 协作（异步，MVP）

```
用户 A 编辑乐谱
   ↓ 点击「完成编辑」
FastAPI：保存最新 MusicXML 到 S3，更新 score.updated_at 和 last_editor_id
   ↓
用户 B 下次打开乐谱
FastAPI：返回最新版本的 MusicXML，顶部显示「最后由 [用户A] 修改于 [时间]」

冲突处理：Last Write Wins（最后保存者覆盖）
并发提示：多人同时在线时，编辑器顶部 Banner 提示「其他人也在编辑，建议错开时间」
```

### A.3 编辑器 Level 2 协作（实时，v1.2 规划）

实时协作不引入完整 OT（Operational Transformation）或 CRDT，采用简化的"操作广播 + 版本号"方案：

```
用户 A 执行编辑操作
   ↓
前端生成 EditOperation { op_type, payload, client_id, timestamp, version }
   ↓ WebSocket 发送到实时服务
实时服务
├── 验证 version（防止过期操作被应用）
├── 广播给同一乐谱的所有在线协作者
└── 应用操作到服务端 Score Model，更新服务端 version

用户 B 收到操作广播
├── 如果 version 连续：直接应用操作到本地 Score Model，触发 Verovio 防抖渲染
└── 如果 version 不连续（有操作丢失）：从服务端拉取最新完整 MusicXML 重新加载
```

此方案不能完美解决所有冲突（两人同时修改同一音符时，后到的操作会覆盖先到的），但对"老师改学生指法"、"朋友一起整理乐谱"这类低冲突场景已经足够，工程复杂度远低于完整 OT/CRDT 实现。

---

## 附录 B · 前端乐谱渲染分工完整说明

### B.1 各场景渲染方案汇总

| 场景 | 渲染方案 | 原因 |
|------|---------|------|
| 乐谱详情页·静态展示 | Verovio WASM | 雕刻质量高，分页渲染，首屏快 |
| 乐谱详情页·播放预览 | Verovio WASM + Tone.js | getElementsAtTime() + renderToMIDI() 天然适合 |
| 练习室·光标跟随 | Verovio WASM + matchmaker 推送 | getElementsAtTime() 处理服务端推送的位置信息 |
| 编辑器·实时渲染 | Verovio WASM + 防抖 300ms | 自建 Score Model 序列化为 MusicXML 后交给 Verovio 渲染 |
| 识别审核页·对比图 | 服务端 Verovio（Python）预生成 PNG | 静态对比，不需要交互，服务端渲染更可靠 |
| 乐谱库缩略图 | 服务端 Verovio（Python）预生成 PNG | 批量生成，CDN 缓存 |
| 导出 PDF | 服务端 Verovio（Python）+ WeasyPrint | 服务端无 GUI 依赖 |
| 导出 MIDI | 服务端 Verovio（Python）renderToMIDI() | 服务端无 GUI 依赖 |

### B.2 OSMD 的保留价值

经过评估，最终方案完全移除了 OSMD 对编辑器渲染的直接依赖。OSMD 在这个项目里不再是必须依赖项，原因如下：

- 编辑器渲染：由 Verovio WASM 承担（雕刻质量更高）
- 编辑器数据模型：由自建 Score Model 承担（不依赖 OSMD 内部结构）
- 阅读器播放同步：由 Verovio 的 `getElementsAtTime()` 承担（无需 OSMD Audio Player）

如果项目组希望保留 OSMD 作为编辑器的备选渲染方案（例如在 Verovio WASM 初始化较慢时作为 fallback），可以保留，但不作为主方案依赖。

### B.3 Verovio WASM 初始化优化

Verovio WASM 文件约 10–15MB，首次加载较慢。优化策略：

- 使用 CDN 分发 WASM 文件，配置长期缓存（Cache-Control: max-age=31536000）
- 在用户进入乐谱相关页面前（如从 Library 页跳转 Score 页时），提前在后台 preload Verovio WASM
- Verovio 初始化完成后缓存 toolkit 实例，不重复初始化
- 展示骨架屏，避免白屏等待

---

## 附录 C · 环境变量与密钥管理规范

### C.1 环境变量分类

所有配置通过环境变量注入，分三类管理：

**公开配置（非敏感，可以写入版本控制的 .env.example）**
```
APP_ENV=production
APP_NAME=PianoJoy
FRONTEND_URL=https://pianojoy.com
API_URL=https://api.pianojoy.com
LOG_LEVEL=INFO
CELERY_WORKER_CONCURRENCY=4
OCR_TIMEOUT_SECONDS=60
SCORE_UPLOAD_MAX_SIZE_MB=20
SCORE_UPLOAD_MAX_PAGES=20
```

**敏感配置（绝不写入版本控制，通过 CI/CD Secrets 注入）**
```
# 数据库
DATABASE_URL=postgresql+asyncpg://user:password@host:5432/pianojoy

# Redis
REDIS_URL=redis://:password@host:6379/0

# JWT（RS256 密钥对）
JWT_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----...
JWT_PUBLIC_KEY=-----BEGIN PUBLIC KEY-----...

# OAuth
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
WECHAT_APP_ID=...
WECHAT_APP_SECRET=...

# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_PREMIUM_MONTHLY=price_...
STRIPE_PRICE_PRO_MONTHLY=price_...

# S3
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
S3_BUCKET_NAME=pianojoy-production
S3_REGION=ap-east-1

# 邮件
RESEND_API_KEY=re_...

# OCR
OCR_API_KEY=...
OCR_API_ENDPOINT=https://...

# 监控
SENTRY_DSN=https://...@sentry.io/...
```

### C.2 不同环境的注入方式

| 环境 | 注入方式 |
|------|---------|
| development（本地）| `.env.local` 文件，被 `.gitignore` 忽略，不提交 |
| staging | GitHub Actions Secrets + Environments（staging 环境变量组）|
| production | GitHub Actions Secrets + Environments（production 环境变量组）|
| Phase 3（K8s）| K8s Secret（敏感）+ K8s ConfigMap（非敏感）|

### C.3 JWT 密钥对生成规范

RS256 需要一对 RSA 密钥：私钥用于签名（只在后端持有），公钥用于验证（可分发给多个服务）。

生成命令：
```
openssl genrsa -out private_key.pem 2048
openssl rsa -in private_key.pem -pubout -out public_key.pem
```

密钥轮转周期：建议每 6–12 个月轮转一次。轮转时：先添加新公钥到验证列表，同时保留旧公钥（处理旧令牌）；切换签名使用新私钥；等待所有旧令牌过期（最多 Access Token 有效期 15 分钟）后，移除旧公钥。

---

## 附录 D · 依赖版本锁定与 Python 环境管理

### D.1 Python 依赖管理

使用 `uv`（Astral 出品）管理 Python 依赖，比 pip 快 10–100 倍，适合 CI 环境：

```
uv pip install -r requirements.txt  ← 安装依赖
uv pip compile requirements.in -o requirements.txt  ← 生成锁定文件
```

每个服务类型维护独立的 requirements 文件：
```
requirements/
├── base.txt          ← 所有服务共享的基础依赖（FastAPI、SQLAlchemy 等）
├── api.txt           ← 主服务额外依赖（Authlib、Stripe 等）
├── worker-ocr.txt    ← OCR Worker 依赖
├── worker-fingering.txt  ← pianoplayer 依赖（pianoplayer 本身依赖复杂）
├── worker-conversion.txt ← Verovio、cairosvg、WeasyPrint
├── worker-email.txt  ← Resend SDK
└── realtime.txt      ← matchmaker 依赖（要求 Python 3.12）
```

### D.2 matchmaker 特殊版本要求

matchmaker 明确要求 Python 3.12，且依赖 PortAudio（系统级音频库）和 Fluidsynth（MIDI 合成器）。Docker 镜像需要额外安装系统依赖：

```
# 在 Dockerfile 的 apt-get install 阶段额外添加：
libportaudio2 portaudio19-dev
fluidsynth libfluidsynth-dev
libsndfile1 libsndfile1-dev
ffmpeg
```

### D.3 前端依赖锁定

使用 `pnpm`（比 npm/yarn 磁盘空间效率更高，monorepo 友好）。所有版本通过 `pnpm-lock.yaml` 锁定。Renovate Bot（或 Dependabot）自动提 PR 更新依赖，保持依赖安全更新不积压。

Verovio WASM 版本需要前后端一致：前端 NPM 包（`verovio/wasm`）的版本应与服务端 `pip install verovio` 的版本保持一致，避免前后端渲染结果不一致（MusicXML 的 xml:id 生成规则可能在不同版本间变化）。

---

## 附录 E · 灾备与数据恢复方案

### E.1 数据备份策略

**PostgreSQL 备份**

使用云托管数据库（Supabase / 阿里云 RDS）的自动备份功能：
- 每日自动全量备份，保留 30 天
- 时间点恢复（PITR）：支持恢复到过去 7 天内的任意时刻
- 备份文件跨可用区存储（防止单机房故障）

手动备份（每次大版本上线前执行）：
```
pg_dump -Fc pianojoy_production > backup_$(date +%Y%m%d_%H%M%S).dump
```

恢复验证：每月在 staging 环境执行一次恢复演练，确认备份文件可用。

**Redis 数据备份**

Redis 里存储的是缓存和 Celery 任务队列，不是主要业务数据。Redis 宕机的恢复策略：缓存数据直接丢弃（应用层自动重建）；Celery 队列里的任务：已分配给 Worker 的任务通过 Celery 的 acks_late=True 确保重启后重新执行；未分配的任务可能丢失（在接受范围内，OCR 任务丢失时用户需要重新上传）。

**S3 文件备份**

开启 S3 跨区域复制（Cross-Region Replication）：主区域（如华东）→ 备区域（如华北）。开启版本控制（Versioning），文件被意外删除后可以恢复历史版本。

### E.2 故障恢复 RTO/RPO 目标

| 故障类型 | RTO（恢复时间目标）| RPO（数据丢失目标）|
|---------|-----------------|-----------------|
| 主服务崩溃（进程级）| < 2 分钟（Docker 自动重启）| 0（无状态服务）|
| 主服务器宕机（机器级）| < 10 分钟（手动重启或切换备机）| 0（数据在数据库）|
| 数据库主节点故障 | < 5 分钟（云托管自动 Failover）| < 30 秒（同步复制）|
| 完整数据中心故障 | < 4 小时（从备份重建）| < 24 小时（上次备份）|
| 数据误删除 | < 1 小时（PITR 恢复）| 0（PITR 恢复到误删前）|

### E.3 应急联系与响应流程

建立简单的 On-call 轮值机制（Phase 1 可以是创始人直接 On-call）：

P0 故障响应流程：
1. Sentry/Prometheus 告警触发，通过电话/短信通知 On-call
2. On-call 在 5 分钟内确认收到告警
3. 15 分钟内开始排查，优先恢复服务（而非找根本原因）
4. 服务恢复后，记录故障时间线和临时修复措施
5. 24 小时内完成故障复盘文档（时间线 + 根本原因 + 改进措施）

---

## 附录 F · 各阶段成本估算

以下为参考估算，实际价格以云服务商当前定价为准。

### F.1 Phase 1 月均成本估算（阿里云，中国区）

| 服务 | 规格 | 月费用（约）|
|------|------|-----------|
| ECS 主服务器 | 4C8G | ¥400–600 |
| ECS Worker 服务器（OCR）| 8C16G | ¥800–1200 |
| ECS Worker 服务器（其他）| 4C8G | ¥400–600 |
| ECS matchmaker 服务器 | 4C8G | ¥400–600 |
| RDS for PostgreSQL | 2C4G | ¥300–500 |
| Redis（托管）| 1GB | ¥100–200 |
| OSS 存储 | 100GB | ¥20–30 |
| CDN 流量 | 500GB/月 | ¥100–150 |
| **合计** | | **约 ¥2500–3900/月** |

注：Vercel 前端部署免费（Pro 计划约 $20/月，基本够用）；Sentry、Resend、Upstash 均有免费额度，早期不计入成本。OCR 商业 API 费用另计（按识别量计费，早期可能为主要成本项）。

### F.2 Phase 2 月均成本增量估算

| 新增服务 | 增量费用（约）|
|---------|------------|
| API 网关（APISIX，独立 ECS）| ¥400–600 |
| PostgreSQL 只读副本 × 1 | ¥200–300 |
| Redis 升级（Sentinel 模式）| ¥200–300 |
| 实时服务独立服务器 | ¥400–600 |
| Prometheus + Grafana（托管）| ¥0（Grafana Cloud 免费额度）|
| **Phase 2 总增量** | **约 ¥1200–1800/月** |

### F.3 Phase 3 成本说明

Phase 3 引入 K8s 后，成本模型发生根本变化：从固定规格的 ECS 转为按 Node Pool 计费，能够更精细地根据实际负载控制成本（低峰期 Worker Pod 缩减到 0）。整体成本会上升（K8s 集群本身的管理费用），但弹性伸缩会避免为峰值流量长期维持高规格服务器。具体成本取决于实际流量和业务规模，无法在架构文档阶段给出准确估算。

---

*技术架构文档 v2.0 完整版结束*

*正文 12 章 + 附录 6 部分*
*覆盖：三阶段演进架构 / 技术选型 / 编辑器架构专项 / 数据架构 / 安全架构 / 部署方案 / 基础设施引入时机 / 监控体系 / ADR 决策记录 / 实时服务详细架构 / 渲染分工 / 环境变量规范 / 依赖管理 / 灾备方案 / 成本估算*
