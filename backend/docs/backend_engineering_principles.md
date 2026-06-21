# Backend Engineering Principles

> Active score-domain restructuring is tracked in
> `../../docs/score-domain-architecture-migration-plan.md`.

## 文档目的

本文基于 `backend/docs/`、`backend/docs/archive/` 以及仓库根目录 `docs/` 中的架构评审、迁移计划、阶段复盘、运行手册、功能设计和质量加固记录，总结 NoteVerse 后端后续开发应遵守的编码规范、架构设计原则和工程结构经验。

这不是新的迁移计划，也不是通用新项目模板，而是一份面向 NoteVerse 现有代码库的长期维护准则。它回答三个问题：

- 什么样的代码放在什么位置
- 什么样的架构边界值得坚持
- 过去已经暴露过哪些问题，后续如何避免重犯

## 一、已经完成过的关键架构调整

后端已经从早期的 `api / schemas / services` 纯技术分层，演进为当前的混合架构：

- 业务功能代码统一进入 `app/modules/*`
- 跨业务共享能力进入 `app/shared/*`
- 数据库 session、worker session 和 ORM 模型入口进入 `app/db/*`
- API 聚合由 `app/api/v1/router.py` 负责，`app/main.py` 保持轻量
- Worker、pipeline、processing 保持技术边界，不强行塞进业务模块
- 文件和对象存储已经收口到 `app/storage/*`，业务模块不直接拼 durable filesystem path
- OMR 和乐谱渲染已经抽象成可配置 engine 边界，避免 pipeline 直接绑定具体实现
- 上传和识别任务已经围绕 durable upload file id、幂等提交、Celery late ack、heartbeat、maintenance job 和 storage materialization 做过可靠性加固
- 本地后端运行时已经收口到 Docker API/worker/beat，数据库和 Redis 仍运行在 Windows host
- LEGATO 作为 pinned external source dependency 放在 `external/legato`，不属于 backend application code
- 旧的 `app/services`、`app/schemas`、`app/api/endpoints` 兼容包装层已被清理或退役
- 回归测试、ruff、mypy、model-layer mypy、pre-commit 和 CI 已经成为质量基线

迁移历史里最重要的经验是：目录移动只是第一步，真正的架构完成必须同时满足导入路径收口、职责边界收口、兼容层清理、测试保护和文档同步。

## 二、推荐的工程结构

当前后端应继续维持以下结构语义：

```text
backend/
|-- app/
|   |-- main.py
|   |-- api/
|   |   |-- deps.py
|   |   `-- v1/
|   |       `-- router.py
|   |-- core/
|   |-- db/
|   |   |-- session.py
|   |   |-- worker_session.py
|   |   `-- models/
|   |-- modules/
|   |   |-- auth/
|   |   |-- files/
|   |   |-- practice/
|   |   |-- profile/
|   |   |-- shares/
|   |   |-- tasks/
|   |   `-- xml/
|   |-- shared/
|   |-- storage/
|   |-- pipeline/
|   |-- processing/
|   |-- worker/
|   `-- utils/
|-- tests/
`-- docs/
```

### 1. `app/modules/*`

业务功能的主要归属地。

一个成熟模块通常包含：

- `router.py`：HTTP 或 WebSocket 入口，只做协议适配、参数绑定、响应封装
- `service.py`：业务编排、权限规则、状态流转、跨 repository 协作
- `repository.py`：数据库查询和持久化访问
- `dependencies.py`：模块内依赖注入、权限解析、服务构造
- `schemas.py`：请求、响应、DTO、TypedDict 或稳定的结果模型

经验：不能只建一个模块目录再从旧路径 re-export。真正的模块化要求路由、schema、service、repository 都物理归位，并且调用方优先依赖 `app.modules.<feature>`。

### 2. `app/shared/*`

只放跨业务、低耦合、可复用的共享能力，例如：

- 响应封装
- 业务错误码和成功码
- 纯共享枚举或文件类型辅助
- 与具体 feature 无关的窄工具

经验：不要把 ORM 强耦合对象随意塞进 shared。`shared` 应保持轻量和低层依赖，避免形成新的大杂烩。

### 3. `app/db/*`

数据库和 ORM 的统一入口。

当前 ORM 模型保持集中放在 `app/db/models/*` 是合理的，因为 `Task`、`File`、`Share`、`User` 等模型跨模块关系密集，强行放进 feature 目录反而会增加耦合，也会让 Alembic 和模型注册更复杂。

经验：模型层类型检查应保持独立硬化轨道。ORM typing 更严格、更吵，不应贸然并入主 mypy 基线，除非团队明确愿意承担成本。

### 4. `app/api/*`

API 层只负责应用级聚合和公共 FastAPI 依赖。

- `app/api/v1/router.py` 负责汇总模块 router
- `app/api/deps.py` 只保留真正公共的认证、数据库和少量兼容依赖
- `app/main.py` 不逐个拼接业务路由

经验：`api/deps.py` 一旦变厚，就会重新变成跨模块耦合中心。模块自己的依赖应该下沉到 `app/modules/<feature>/dependencies.py`。

### 5. `app/core/*`

运行时基础设施，例如：

- 配置
- 日志
- 安全
- 异常处理
- middleware
- startup checks
- lifespan wiring

经验：`core` 不是业务逻辑放置点。业务规则、权限规则、文件处理规则不应因为“全局会用”就进入 `core`。

### 6. `app/pipeline/*`、`app/processing/*`、`app/worker/*`

复杂处理流程继续按技术职责组织：

- `pipeline`：任务流程编排、步骤控制、上下文传递
- `processing`：OCR、渲染、MusicXML、音频、score following 等具体执行能力和引擎适配
- `worker`：Celery 运行时入口、worker-only wiring

经验：实时 WebSocket 会话、音频缓冲和 score-following 引擎不适合放 Celery；Celery 适合 OCR、离线处理、报告生成等非实时任务。

### 7. `app/storage/*`

文件和对象存储的统一边界。

当前职责包括：

- 本地存储和 S3-compatible storage adapter
- durable object key 规范
- signed access URL / download URL
- remote object materialization
- 统一存储路径和 backend authorization 入口之间的关系

业务模块不应直接构造 durable storage path，也不应把 API 进程本地路径传给 Celery worker。上传、头像、XML、预览页、最终渲染页、归档、练习读取和 worker 产物记录都应通过 `app.storage`。

经验：本地路径是进程视角，不是系统契约。任务重试、多 worker、多 pod、S3-compatible storage 和 late acknowledgement 都要求 Celery payload 使用 durable file id 或 storage key，而不是 API-local filesystem path。

## 三、编码规范

### 1. 路由层保持薄

路由函数应只做：

- 接收请求参数
- 绑定依赖
- 调用 service
- 返回统一响应

路由函数不应做：

- 数据库查询细节
- 状态机判断
- 文件系统编排
- Worker 内部调用细节
- 音频、OCR、渲染、对齐算法逻辑

如果路由函数开始变长，优先把规则移到 service，把 DB 访问移到 repository，把协议解析移到 schema 或 codec。

### 2. Service 只做业务编排

Service 层负责回答“这件业务能不能做、应该按什么顺序做”。

适合放 service 的内容：

- 访问权限判断
- 业务状态转换
- 调用多个 repository 或 processing 能力
- 把底层结果整理成稳定的业务结果
- 抛出统一业务异常

不适合放 service 的内容：

- 大量 SQL 查询细节
- 低层文件格式解析
- 第三方引擎内部适配
- WebSocket 二进制帧缓冲
- Celery 运行时细节

经验：过去 `services/` 语义过载，混入了业务逻辑、持久化逻辑和 worker helper。后续应避免让 `service` 重新变成“放不下就放这里”的目录或文件名。

### 3. Repository 只做持久化访问

Repository 应封装数据库查询和写入，让 service 不必知道复杂 SQLAlchemy/SQLModel 表达式。

良好 repository 的特征：

- 方法名表达业务查询意图
- 返回稳定模型或明确 DTO
- 不拼接响应 JSON
- 不抛出 HTTP 层异常
- 不承担跨模块业务编排

经验：N+1 查询、重复 session reset、Optional ID 噪音和 ORM 表达式 typing 问题，往往都能通过 repository 边界和 typed helper 更早暴露。

### 4. Schema 是契约入口

请求、响应和稳定结果结构应放在模块 `schemas.py` 中。

避免：

- 在 endpoint 内定义匿名 `BaseModel`
- 同一个请求结构在多个文件重复定义
- schema 字段与 ORM 字段长期漂移
- 用 `dict[str, object]` 表达已经稳定的业务结果

推荐：

- Pydantic model 用于 API 请求/响应
- TypedDict 或 dataclass 用于内部稳定结果
- enum 值端到端保持一致，不在中间层随意转成 raw string

经验：早期的 `password_hash / hashed_password`、`owner_user_id / created_by_user_id`、`SavedShare.task_id` 残留，本质都是契约漂移。字段命名不统一不是审美问题，而是正确性问题。

### 5. 统一异常和响应风格

继续使用项目已有的异常和响应机制：

- `ValidationException`
- `UnauthorizedException`
- `ResourceNotFoundException`
- `AppException`
- `success_response(...)`
- `ErrorCode`
- `SuccessCode`

避免在局部代码里手写不一致的 JSON 响应、临时错误码或散落的字符串错误。

### 6. 类型收紧要增量推进

主线代码应保持 `ruff + mypy + pytest` 绿色。

对于 ORM-heavy 区域：

- 使用 `mypy-model-layer.ini` 做独立检查
- 一次只扩大少量低风险文件
- 优先处理 Optional ID、SQLAlchemy 表达式和 enum/value mismatch
- 不要为了“全量类型完美”打断正常功能交付

经验：类型检查最有价值的地方是稳定边界，而不是制造大规模、无业务收益的机械改写。

## 四、架构设计原则

### 1. 混合架构优于单一分层

本项目同时存在业务功能和重型技术能力。纯 feature-first 会让 pipeline、processing、worker 变碎；纯 technical-layer 会让业务逻辑跨目录漂移。

因此当前原则是：

- 业务功能按 feature 进入 `app/modules/*`
- 平台和运行时能力按技术责任保留在 `core/db/pipeline/processing/worker`
- 共享能力只在真正跨模块且低耦合时进入 `shared`

### 2. 边界比目录名更重要

目录名正确但文件仍是兼容转发，不能算完成。

判断一个模块是否成熟，看这些问题：

- router 是否真实在模块内
- schema 是否真实归属于模块
- service 是否承担清晰业务编排
- repository 是否承接数据库访问
- 调用方是否使用 canonical import
- 测试是否覆盖关键行为

### 3. 不把过渡层当扩展点

历史兼容层只用于迁移，不用于新功能。

禁止为新功能重新引入：

- `app/services/*`
- `app/schemas/*`
- `app/api/endpoints/*`
- `app/core/db.py`
- `app/worker/db.py`

如果旧路径重新出现，默认应迁到：

- `app/modules/*`
- `app/shared/*`
- `app/db/*`

### 4. 实时和异步离线任务要分开

实践功能的设计给出了很好的边界样例：

- REST 生命周期在 `app/modules/practice`
- WebSocket 控制和二进制帧入口保持路由薄
- session runtime、audio buffer、message codec 在 `app/processing/realtime`
- Matchmaker、score timeline 和音频特征处理在 `app/processing/engines`
- Celery 只用于适合排队的后台任务

原则：低延迟、双向、会话态、内存态的逻辑不要扔给 Celery；长耗时、可重试、离线处理才适合 worker。

### 5. 功能复杂时先稳定协议，再换真实引擎

实践实时功能先用 fake alignment engine 验证 WebSocket 协议、状态流转和前后端契约，再接 Matchmaker。这是正确顺序。

复杂功能推荐顺序：

1. 定义持久化模型和 API 契约
2. 建立模块骨架和薄路由
3. 用 fake/mock 引擎验证协议闭环
4. 增加回归测试
5. 接入真实引擎
6. 再优化性能、置信度和体验

不要在协议未稳时同时引入真实算法、前端渲染和复杂状态机。

### 6. 权限模型要少分支、可解释

分享访问从匿名访问改成登录后访问，是一次有价值的权限模型收口：

- 登录身份是访问前提
- share token 是资源能力凭证
- `can_download`、`can_edit` 等权限继续保留

经验：混合匿名和登录访问会让前端路由、API client、download 权限、practice 入口和测试全都出现分支。权限模型越简单，越容易审计和扩展。

### 7. 外部工具要有明确边界和固定版本

LEGATO 是第三方源码工具，不是 NoteVerse backend code。

当前规则：

- 放在 `external/legato`
- 用 `LEGATO_REPO_COMMIT` 固定 commit
- Docker 中只读挂载到 `/external/legato`
- 不随意修改其源码
- 如果需要本地 patch，必须文档化，并考虑 fork 或 patch file

经验：当第三方项目没有标准 Python packaging metadata，且应用依赖其 repository scripts 或非安装入口时，不要强行伪装成普通 backend module。保持 `backend/`、`frontend/`、`external/` 边界，后续排查和升级会轻很多。

### 8. Engine 抽象优于把工具名写进流程

OMR 和渲染通过稳定接口与具体实现隔离：

- `OMREngine`
  - `LegatoOmrEngine`
- `ScoreRenderEngine`
  - `VerovioRenderEngine`

后续 pipeline、XML confirm、editor save、preview/final render 都应依赖 engine factory 和通用 result shape，不要在流程中直接 import 具体引擎或按引擎名称分支。

重要经验：

- 选中的 engine 就是边界，开发阶段不要用 fallback 隐藏 engine failure
- LEGATO 当前可靠路径是 `image -> LEGATO -> ABC -> MusicXML -> normalized MusicXML`
- 不要依赖渲染器宽容修复 MusicXML，进入渲染阶段前应完成规范化
- SVG/PNG 是 MIME type 和 renderer 输出差异，不应让前端或 file kind 名字硬编码为 PNG 假设
- 所有 OMR 引擎通过有序图片列表进入 `process_images()`；具体实现负责逐页识别、转换与合并

### 9. 可靠性设计要围绕 durable state

上传和任务链路的核心可靠性原则是：用户可见状态在数据库，文件内容在 durable storage，worker 可以重试或换机器执行。

当前已经形成的规则：

- 上传先入 durable storage，再写 upload row，再返回 sha256 `file_id`
- 提交任务时传 durable upload file id，不传 API-local path
- worker 在自己的 `WORK_ROOT` 中 materialize 输入文件
- `submit-batch` 支持 `idempotency_key`，防止重复提交
- Celery 使用 late acknowledgement 和 `task_reject_on_worker_lost`
- `worker_prefetch_multiplier=1`
- 任务进度更新刷新 `last_heartbeat_at`
- beat maintenance 处理 stale `PENDING` / `PROGRESS` task
- orphan upload 按 TTL 清理
- dispatch 失败立即标记 task failed，DB outbox 暂缓到确有必要时再做

经验：任务系统不能只关注 happy path。真正要防的是 DB 创建成功但 dispatch 失败、broker 丢消息、worker 中途死亡、用户上传后离开、多 worker 本地路径不一致、重复点击提交等边界。

### 10. 练习跟随稳定性来自多层保护

练习 score following 的方向不是推翻 `Chroma + Matchmaker/Arzt OLTW`，而是在现有主路径上增强可解释性、可回放评测和 UI 保守提交。

后续优化应遵守：

- 先补 diagnostics 和 decision reason，再调阈值
- 真实音频 replay evaluation set 优先于单次日志调参
- 输入侧和输出侧都要保护，但职责不同
- 后端可以输出 raw candidate、confidence、frame class、validation reason
- 前端只展示 committed alignment，不直接展示 raw OLTW output
- `visual_confidence` 应保留为 final signal，同时补充可解释字段
- 不要立刻改 OLTW 内核，先用 hold-last-position、confidence ceiling、commit window、feature attenuation 等外围机制近似 soft weighting

短期最关键的开发顺序：

1. diagnostics / decision reasons
2. 真实音频回放评测集
3. 前端 N-frame commit
4. explicit frame classifier
5. session/activity 边界拆分
6. output validation
7. latency 和 UX polish

经验：继续只加阈值会让系统变成经验拼图。每次修一个 case 都可能破坏另一个 case。先让系统能解释“为什么启动、为什么入队、为什么 commit、为什么 hold”，再谈策略优化。

## 五、运行时和部署开发准则

### 1. 本地后端运行时以 Docker 为准

当前唯一支持的本地后端运行方式是：

- Windows host 保留数据库和 Redis
- Docker 只运行 backend API、Celery worker、Celery beat
- backend source bind mount 到 `/app`
- `external/legato` read-only bind mount
- model directory read-only bind mount 到 `/opt/noteverse/models`
- `backend/data` bind mount 以保留本地 storage 和 work cache

经验：这样可以让代码迭代仍然快速，同时让 API/worker/beat 更接近 Linux runtime。不要把模型、external repo、cache、data 复制进镜像；镜像应包含 runtime dependencies，不包含业务数据和模型文件。

### 2. Runtime dependency 检查要前置

变更 Docker image、`.env.docker`、模型挂载、LEGATO commit、PaddleOCR/torch/CUDA 版本后，先跑 runtime check，而不是直接调业务接口。

推荐顺序：

1. `docker compose -f docker-compose.backend-dev.yml build`
2. `docker compose -f docker-compose.backend-dev.yml run --rm api check`
3. `docker compose -f docker-compose.backend-dev.yml run --rm api migrate`
4. 用一个已知样本跑上传、review、editor、practice 主流程

经验：ML runtime 问题、CUDA wheel/driver 不匹配、模型目录缺失、Hugging Face cache symlink 损坏和 external repo commit 漂移，都应在 runtime check 阶段暴露，不要让它们表现成业务 bug。

Runtime check 按进程角色划分：API 检查异步数据库、存储和 practice runtime；worker 检查同步数据库、broker、任务注册、处理引擎和模型；beat 只检查 broker 与 schedule 目录。worker/beat 在启动 Celery 前执行必要门禁并失败退出，不提供绕过开关。FastAPI lifespan 保持轻量，`/health/live` 不访问外部依赖，`/health/ready` 只将数据库视为全局 readiness 条件；Redis 故障报告 degraded，但不应让登录、历史记录等非队列功能被整体摘流量。

## 六、测试和质量门禁

后端结构或行为变更前后，至少运行：

```powershell
..\scripts\backend_quality.ps1 ruff
..\scripts\backend_quality.ps1 mypy
..\scripts\backend_quality.ps1 mypy-model-layer
..\scripts\backend_quality.ps1 pytest
```

测试策略应按风险选择：

- 路由、认证、权限改动：补 API smoke 或权限回归
- service 状态机改动：补 service regression
- repository 查询改动：补 DB-backed 或 repository 测试
- pipeline/processing 改动：补流程 wiring、fixture 或 engine 边界测试
- WebSocket/实时流改动：补协议消息、二进制帧、异常和状态转换测试
- 配置/启动改动：补 import、settings、runtime smoke
- storage 改动：补 local/S3 adapter、signed URL、materialize、download behavior 测试
- Celery 任务改动：补 retry、heartbeat、stale maintenance、idempotency 或 dispatch failure 测试
- OMR/render engine 改动：补 factory selection、engine result mapping、MusicXML normalization、MIME type 和 SVG/PNG 兼容测试
- practice score following 改动：补 replay evaluation、diagnostics 字段、N-frame commit 和 frame classification 测试

经验：Phase 1 暴露过“改完但验证闭环不足”的问题。后续任何迁移或重构都不能只用 `py_compile` 证明完成，至少要有针对关键行为的 pytest。

## 七、文档维护规范

当前文档应分层维护：

- 顶层 docs 保留当前有效规则、当前架构、当前待办
- 迁移过程、阶段记录、历史方案进入 `docs/archive/`
- 新功能设计完成后，应更新对应 task plan 的状态
- 被替代的旧假设要及时删除或标记归档
- 外部依赖升级必须同步更新 pinned commit、env example、config default 和 dependency 文档
- runtime 工作流变更必须同步更新 Docker runbook
- OMR/render engine 默认值或输出格式变更必须同步更新前后端兼容说明
- 上传/任务可靠性策略变更必须同步更新 maintenance、storage、Celery 和 frontend retry 约定

不要让顶层 docs 重新堆满历史阶段语言。后续贡献者最需要的是“现在应该怎么做”，不是重新读完整迁移史。

## 八、最容易复发的问题清单

后续 code review 应重点防止以下问题：

1. 新代码绕过 `app/modules/*`，直接塞进 `core`、`api` 或旧路径。
2. `router.py` 重新变厚，包含 DB 查询、状态机或引擎逻辑。
3. `service.py` 重新承担 repository、worker helper、文件处理和响应拼装等多重职责。
4. schema 与 ORM 字段出现两个名字，并长期共存。
5. 为了赶功能临时使用 `dict[str, object]`，后续没有收成稳定 DTO。
6. 旧兼容路径重新被 import，形成新的隐性扩展点。
7. `api/deps.py` 重新积累 feature-specific 依赖。
8. 权限模型出现匿名/登录、多入口、多分支并存，却没有清晰规则文档。
9. 实时会话逻辑误用 Celery，或把离线任务塞进 WebSocket runtime。
10. 大规模重构没有阶段冻结、任务板、验证记录和回归测试。
11. 只做目录迁移，不做导入路径、测试和文档同步。
12. 历史文档不归档，导致团队分不清当前规则和旧计划。
13. 业务模块重新直接拼 durable file path，绕过 `app.storage`。
14. Celery payload 重新携带 API-local path，导致重试或多 worker 场景失效。
15. OMR/render 流程出现具体引擎专用命名、直接 import 或按品牌分支。
16. Engine fallback 悄悄吞掉选定 engine 的失败，导致缺陷被隐藏。
17. LEGATO 等 external dependency 被当作 backend 源码随意修改。
18. Docker runtime、模型挂载、CUDA/Paddle/PyTorch 版本变更没有先跑 runtime check。
19. 练习跟随继续只靠阈值调参，没有 replay fixture 和 diagnostics reason。
20. 前端直接展示 raw alignment，而不是 committed alignment。

## 九、后续开发的推荐流程

新增或修改后端功能时，建议按下面顺序工作：

1. 先判断功能归属：feature、shared、db、core、storage、pipeline、processing、worker。
2. 如果是业务功能，优先在 `app/modules/<feature>` 下补齐 router/service/repository/schemas/dependencies。
3. 先设计请求、响应、错误码、权限规则和状态流转，再写实现。
4. 路由只调用 service，service 只编排业务，repository 只访问数据库。
5. 对复杂外部能力先做窄 adapter，不让第三方细节泄漏到模块层。
6. 对不稳定或复杂的引擎先 mock/fake，等协议和测试稳定后再接真实实现。
7. 每完成一个可验证切片就运行相应测试，不把验证留到最后。
8. 如果涉及 durable 文件，先设计 storage key、access URL、materialize 和 cleanup 规则。
9. 如果涉及 worker，先设计幂等、重试、heartbeat、stale recovery 和 failure marking。
10. 如果涉及 OMR/render/practice engine，先设计 engine boundary、result type、diagnostics 和回放验证。
11. 更新当前文档，历史记录放 archive。

## 十、判断代码是否健康的简短标准

一段后端代码通常是健康的，如果它满足：

- 新行为能在一个明确模块内找到
- 入口、业务、持久化、运行时能力边界清楚
- import 路径指向 canonical location
- schema 和 model 字段命名一致
- 错误码、成功码和异常风格统一
- 复杂结果有类型，不靠松散 dict 传来传去
- 测试能保护关键行为
- 文档不会误导后续贡献者使用旧结构
- durable 文件访问经过 `app.storage`
- worker 输入可以跨进程、跨机器重新 materialize
- 外部 engine 和第三方源码被窄边界隔离
- 复杂运行时问题有 diagnostics，而不只能靠猜日志

反过来，如果一个改动需要同时解释“这里暂时放一下”“这个旧路径也能用”“这个字段两个名字都行”“这个接口先不测”，它大概率正在制造下一轮架构债。

XML artifact boundary update (2026-06-20): the product XML read endpoint exposes only `current` and `final`. `enhanced_xml` is a recorded internal pipeline artifact, not a selectable source and not a fallback for missing `current_xml`. XML and practice flows fail explicitly when the requested current or final artifact is absent.

Share creation contract update (2026-06-21): owner-created links persist `can_download`, `can_edit`, and either a bounded day count or a genuinely permanent `expires_at = NULL`. Results/share UI must consume these persisted fields; it must not simulate editable or permanent links with frontend-only state.

## Bottom Line

这次后端迁移最大的收获不是某个目录名，而是一套工程节奏：

- 先修正契约漂移
- 再建立清晰结构
- 然后把包装层变成真实模块
- 接着清理兼容债
- 最后用测试、类型检查、CI 和文档防止回退

后续最好的做法不是重新设计一套架构，而是在当前混合架构下持续保持边界清楚、契约稳定、验证充分、文档克制。
