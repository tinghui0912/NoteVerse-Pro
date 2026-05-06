# FastAPI 项目目录规划与命名规范评审

## 文档目的

本文档用于总结 `backend` 目录下当前 FastAPI 项目的目录规划、文件命名、分层设计和可维护性问题，并给出后续优化建议。

评审范围主要包括：

- `backend/app/`
- `backend/run.py`
- `backend/worker.py`
- `backend/alembic/`
- `backend/scripts/`

以下内容不作为源码结构评审重点：

- `venv/`
- `logs/`
- `var/`
- `__pycache__/`

## 总体结论

当前项目并不是“目录混乱”的状态，已经具备比较明显的工程化分层意识，属于“结构雏形较好，但规范尚未完全收口”的项目。

目前已经形成的优点：

- 有比较清晰的基础分层：`api / core / models / schemas / services / worker`
- 路由文件命名清晰，按业务域拆分为 `auth.py / files.py / tasks.py / shares.py / profile.py / xml.py`
- Worker 和 Pipeline 被单独抽离，说明项目已经考虑异步任务和复杂处理流程
- 配置、异常、日志、安全能力被集中放入 `core/`

但目前也存在几类明显问题：

- 部分模型字段命名与调用代码不一致
- API 层、Service 层、Worker 层的职责边界尚未完全统一
- `pipeline` 和 `processing` 的职责边界不够直观
- `schemas` 没有完全成为唯一的数据模型入口
- 存在旧字段、旧命名、旧设计残留

因此，本项目当前更准确的评价是：

**基础结构合理，但还没有形成一套稳定、统一、可持续扩展的目录和命名规范。**

## 当前目录结构概览

当前源码核心目录如下：

```text
backend/
├─ app/
│  ├─ api/
│  │  ├─ deps.py
│  │  └─ endpoints/
│  ├─ constants/
│  ├─ core/
│  ├─ models/
│  ├─ pipeline/
│  ├─ processing/
│  ├─ schemas/
│  ├─ services/
│  ├─ utils/
│  ├─ worker/
│  └─ main.py
├─ alembic/
├─ scripts/
├─ run.py
└─ worker.py
```

这套结构本身没有明显违背 FastAPI 项目常见实践，但细节上还需要进一步规范。

## 现有优点

### 1. 基础分层方向正确

当前项目已经具备典型后端项目的基础层次：

- `api/` 负责接口暴露
- `models/` 负责 ORM 模型
- `schemas/` 负责请求与响应数据结构
- `services/` 负责业务逻辑
- `worker/` 负责 Celery 相关能力
- `core/` 负责配置、日志、安全、异常等基础设施

这是一个比较好的起点。

### 2. 路由命名总体清晰

接口文件按照业务语义命名，而不是按 HTTP 方法或通用名命名，整体可读性较好：

- `auth.py`
- `files.py`
- `tasks.py`
- `shares.py`
- `profile.py`
- `xml.py`

这类命名方式比 `user_api.py`、`misc.py`、`views.py` 更清楚。

### 3. Worker 与主应用有显式区分

项目中有：

- `backend/worker.py`
- `app/worker/`
- `app/pipeline/`

说明异步任务系统已经被看作独立运行单元，这一点对生产环境是有价值的。

### 4. 复杂处理流程被抽象出来

`pipeline/` 和 `processing/` 的存在说明项目已经不是“所有逻辑全堆在路由里”的状态。对于图像处理、OCR、MusicXML 这类复杂流程，这种拆分是必要的。

## 主要问题与风险

## 1. 模型字段命名与调用代码不一致

这是当前最需要优先处理的问题之一。

### 表现

- `User` 模型中实际字段是 `password_hash`
- 但部分接口代码仍然使用 `hashed_password`

例如：

- [profile.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/api/endpoints/profile.py#L91)
- [profile.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/api/endpoints/profile.py#L97)
- [user.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/db/models/user.py#L25)

类似问题还包括：

- `Share` 模型使用 `owner_user_id`
- 但依赖代码仍访问 `created_by_user_id`

例如：

- [deps.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/api/deps.py#L113)
- [share.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/db/models/share.py#L21)

还有：

- `SavedShare` 模型已不再包含 `task_id`
- 但业务逻辑和 schema 仍在使用 `task_id`

例如：

- [share.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/db/models/share.py#L35)
- [share_service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/services/share_service.py#L500)
- [share_service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/services/share_service.py#L502)
- [share.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/schemas/share.py#L32)

### 风险

- 增加运行时错误风险
- 让目录分层“看起来规范”，但实际契约已经漂移
- 新成员难以判断哪个命名才是当前标准

### 建议

- 全项目统一模型字段命名
- 清理旧字段名残留
- 让 `schemas`、`services`、`deps` 与 `models` 统一依赖同一套命名

## 2. API 层和 Worker 层耦合过深

按项目注释设计，API 层本应只负责：

- 参数校验
- 权限校验
- 调用 service
- 格式化响应

但实际代码里，API 层直接调用了 worker 专用同步数据库访问和同步任务服务。

例如：

- [tasks.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/api/endpoints/tasks.py#L79)
- [tasks.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/api/endpoints/tasks.py#L80)
- [tasks.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/api/endpoints/tasks.py#L81)
- [tasks.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/api/endpoints/tasks.py#L165)
- [tasks.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/api/endpoints/tasks.py#L166)
- [tasks.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/api/endpoints/tasks.py#L189)

服务层也有类似现象：

- [share_service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/services/share_service.py#L398)
- [share_service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/services/share_service.py#L399)

### 风险

- API 层知道太多 Worker 内部实现
- 同步 DB 与异步 DB 混用逻辑扩散
- 后续若要替换任务系统或重构 worker，很难只改一层

### 建议

- 让 API 层只依赖应用 service
- Celery 提交、任务状态读取、同步 session 操作收敛到专门的应用服务或仓储层
- 避免在 endpoint 内直接 `from app.worker...`

## 3. `services/` 目录职责不纯

`services/` 里目前同时存在：

- 真正的业务服务
- 同步 ORM 持久化操作
- Worker 环境专用数据库访问逻辑

典型例子是：

- [task_service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/services/task_service.py)
- [worker_task_service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/services/worker_task_service.py)

其中 `worker_task_service.py` 更像是：

- `worker_task_repository.py`
- `task_store.py`
- `worker_task_gateway.py`

而不是传统意义上的业务 service。

### 风险

- `services/` 目录语义越来越模糊
- 团队后续不知道“业务逻辑”和“数据库访问逻辑”应放在哪里

### 建议

引入 `repositories/` 或 `stores/` 目录，例如：

```text
app/
├─ repositories/
│  ├─ task_repository.py
│  ├─ share_repository.py
│  └─ worker_task_repository.py
├─ services/
│  ├─ task_service.py
│  ├─ share_service.py
│  └─ xml_service.py
```

## 4. `pipeline/` 与 `processing/` 边界不够清晰

当前这两个目录都在表达“处理流程”：

- `pipeline/`
- `processing/`

从代码内容看，大致可以理解为：

- `pipeline/`: 任务流程编排、上下文、步骤管理
- `processing/`: 调外部工具、OCR、提取器、处理器

这个划分本身可以成立，但目录名偏抽象，容易让人混淆。

### 风险

- 新代码不知道应放到 `pipeline` 还是 `processing`
- 处理逻辑持续扩展后会产生双重入口

### 建议

至少要在团队内固定约定：

- `pipeline/` 只放流程控制和步骤编排
- `processing/` 只放执行能力、引擎适配器、提取器

如果后续继续演进，可以考虑更明确命名：

- `pipeline/`
- `engines/`
- `adapters/`
- `processors/`

## 5. `schemas/` 没有完全成为唯一数据模型入口

项目里已经有 `app/schemas/share.py`，但接口文件中仍然内联定义请求模型。

例如：

- [shares.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/api/endpoints/shares.py#L32)

### 风险

- 请求模型分散
- 后续维护时难以快速定位字段定义
- 可能产生 schema 与 endpoint 内联类不一致的问题

### 建议

所有请求/响应模型统一收口到 `schemas/`：

- 路由文件不再定义 `BaseModel`
- `endpoint` 只导入 schema

## 6. 常量层与模型层存在反向耦合

当前：

- [constants/__init__.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/constants/__init__.py) 从模型层导出 `FileKind`

这意味着“常量包”依赖“模型包”。

### 风险

- 依赖关系不清晰
- 常量不再是纯常量
- 容易形成循环依赖或导入链复杂化

### 建议

以下二选一：

- 把 `FileKind` 保持在模型层，不通过 `constants` 再导出
- 或把 `FileKind` 真正迁移到 `constants/file_kinds.py`

推荐后者，如果它本质是领域枚举而不是 ORM 专属定义。

## 7. API 路由聚合方式还不够标准化

当前 [main.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/main.py#L12) 直接导入所有 endpoint 模块，并在 [main.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/main.py#L148) 到 [main.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/main.py#L153) 逐个注册。

而 [endpoints/__init__.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/api/endpoints/__init__.py) 实际为空。

### 风险

- 路由继续增多时，`main.py` 会越来越重
- 版本化 API 不方便扩展

### 建议

更推荐的结构：

```text
app/api/
├─ deps.py
└─ v1/
   ├─ router.py
   └─ endpoints/
      ├─ auth.py
      ├─ files.py
      ├─ tasks.py
      ├─ shares.py
      ├─ profile.py
      └─ xml.py
```

然后在 `main.py` 中只引入一个总路由对象。

## 8. 缺少测试目录

当前源码目录下没有测试包。

### 风险

- 命名漂移和模型失配不容易第一时间发现
- 难以在重构目录时保证行为不变

### 建议

补充至少以下结构：

```text
app/tests/
├─ api/
├─ services/
├─ worker/
└─ conftest.py
```

## 9. 运行产物与源码目录距离过近

虽然 `.gitignore` 已经排除了：

- `venv/`
- `logs/`
- `var/`

但它们仍真实存在于 `backend` 根目录下。

### 风险

- 项目阅读时噪音很大
- IDE 索引和全局搜索体验变差
- 新成员容易把“运行产物”误认为“源码结构的一部分”

### 建议

可继续保留 `.gitignore`，但从工程体验看更推荐：

- 将本地虚拟环境挪到项目外
- 将运行日志、临时文件、上传文件目录与源码更清晰隔离

## 命名规范评价

## 整体评价

整体命名风格大体统一，基本符合 Python 项目常见习惯：

- 文件名以小写下划线为主
- 路由文件与业务名一致
- service 文件以 `_service.py` 结尾

但目前存在几类命名问题：

### 1. 同一概念存在多个名字

例如：

- `password_hash`
- `hashed_password`

例如：

- `owner_user_id`
- `created_by_user_id`

这类问题比单纯“名字不好看”更严重，因为它会影响代码正确性。

### 2. `service` 这个词被过度使用

有些文件其实更接近：

- repository
- storage access
- worker persistence helper

但仍被命名为 `service`

长期看会弱化目录语义。

### 3. schema 命名与实际模型存在版本残留

例如 [share.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/schemas/share.py) 里仍保留与当前模型不一致的字段设计，说明 schema 命名和结构还没有完全跟着实体演进。

## 推荐目标结构

如果后续要继续往“更稳定、可扩展、适合生产维护”的方向演进，推荐逐步收敛为以下结构：

```text
backend/
├─ app/
│  ├─ main.py
│  ├─ api/
│  │  ├─ deps.py
│  │  └─ v1/
│  │     ├─ router.py
│  │     └─ endpoints/
│  │        ├─ auth.py
│  │        ├─ files.py
│  │        ├─ tasks.py
│  │        ├─ shares.py
│  │        ├─ profile.py
│  │        └─ xml.py
│  ├─ core/
│  │  ├─ config.py
│  │  ├─ security.py
│  │  ├─ logger.py
│  │  ├─ middleware.py
│  │  └─ exceptions.py
│  ├─ db/
│  │  ├─ session.py
│  │  └─ base.py
│  ├─ models/
│  ├─ schemas/
│  ├─ repositories/
│  ├─ services/
│  ├─ worker/
│  ├─ pipeline/
│  ├─ processing/
│  ├─ utils/
│  └─ tests/
├─ alembic/
├─ scripts/
├─ run.py
└─ worker.py
```

说明：

- `db/` 用于收口数据库 session/base 等能力
- `repositories/` 负责持久化访问
- `services/` 只负责业务逻辑
- `api/v1/router.py` 负责路由聚合
- `schemas/` 成为唯一请求/响应模型入口

## 建议的重构顺序

为了降低风险，建议不要一次性大改目录，而是分阶段推进。

### 第一阶段：先修正命名和字段漂移

优先处理：

- `password_hash` 与 `hashed_password`
- `owner_user_id` 与 `created_by_user_id`
- `SavedShare.task_id` 残留
- `ErrorCode` 中不存在但仍被调用的字段名

这一阶段的目标是让“模型契约统一”。

### 第二阶段：收口 schema 和路由层

处理内容：

- 将 endpoint 内联 `BaseModel` 移入 `schemas/`
- 新建 `api/v1/router.py`
- 让 `main.py` 只注册总路由

这一阶段的目标是让 API 层结构标准化。

### 第三阶段：拆分 repository 与 service

处理内容：

- 将 worker 专用同步数据库逻辑从 `services/` 拆到 `repositories/` 或 `worker/`
- 让 service 只保留业务编排

这一阶段的目标是让分层职责变得明确。

### 第四阶段：明确 pipeline 与 processing 边界

处理内容：

- 给两个目录建立固定规则
- 必要时调整目录命名

这一阶段的目标是提升复杂处理流程的可维护性。

### 第五阶段：补测试

至少覆盖：

- 用户认证
- 分享逻辑
- 任务提交流程
- Worker 状态查询
- XML 保存与确认

这一阶段的目标是为后续重构提供安全网。

## 最终结论

当前项目的目录规划在方向上是合理的，已经明显优于把所有逻辑堆在 `main.py` 或单个 `routers.py` 里的初级结构。

但从“优秀的生产项目规范”来看，还存在以下关键问题需要尽快优化：

- 命名未完全统一
- 模型契约存在旧设计残留
- API 与 Worker 边界过深耦合
- `services` 目录语义不纯
- `schemas` 未完全统一收口
- 缺少测试目录

因此，当前最合适的判断是：

**结构基础不错，具备继续演进的条件，但要想达到稳定、规范、适合长期维护的工程水平，还需要完成一次有计划的结构收敛。**
