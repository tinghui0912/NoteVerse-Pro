# 第一阶段实际重构清单

## 文档目的

本文档基于：

- [fastapi_project_structure_review.md](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/docs/archive/fastapi_project_structure_review.md)
- [fastapi_hybrid_architecture_migration_plan.md](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/docs/archive/fastapi_hybrid_architecture_migration_plan.md)

进一步收敛出“第一阶段实际重构清单”。

第一阶段的目标不是立即完成混合模式目录迁移，而是：

- 先把当前项目的实体契约、命名和关键边界稳定下来
- 解决影响后续重构的旧字段残留和结构漂移
- 为第二阶段引入 `modules/` 和 `api/v1/router.py` 做准备

一句话概括：

**第一阶段先修“地基”，不做大搬家。**

## 第一阶段的总目标

第一阶段完成后，项目应达到以下状态：

1. 模型字段命名统一，不再有旧字段残留
2. schema 与 model 基本对齐
3. API、service、worker 之间的明显错误引用被清理
4. 为后续目录迁移预留清晰边界
5. 在不大动目录结构的前提下，提高代码可维护性

## 第一阶段不做的事

为了控制风险，以下内容明确不放在第一阶段：

- 不进行大规模目录迁移
- 不立即引入完整 `modules/` 结构
- 不重命名 `models/` 为 `domain/`
- 不重写 `pipeline/` 和 `processing/`
- 不全面改造 Celery 架构
- 不做大范围功能逻辑重构

第一阶段的原则是：

**只改会阻碍后续架构演进的关键问题。**

## 第一阶段的实际清单

下面按照优先级给出实际执行清单。

## A. 统一实体字段命名与引用

这是第一阶段最优先的工作。

## A1. 统一 `User` 密码字段命名

### 当前问题

`User` 模型里使用的是 `password_hash`，但部分业务代码仍在使用 `hashed_password`。

相关文件：

- [user.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/models/user.py#L25)
- [profile.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/api/endpoints/profile.py#L91)
- [profile.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/api/endpoints/profile.py#L97)

### 第一阶段动作

- 全项目统一使用 `password_hash`
- 删除所有 `hashed_password` 引用

### 验收标准

- `rg "hashed_password" backend/app` 不再出现业务引用
- 修改密码、登录、注册逻辑全部使用同一字段名

## A2. 统一 `Share` 所有者字段命名

### 当前问题

`Share` 模型使用 `owner_user_id`，但依赖代码中仍有 `created_by_user_id`。

相关文件：

- [share.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/models/share.py#L21)
- [deps.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/api/deps.py#L113)

### 第一阶段动作

- 全项目统一使用 `owner_user_id`
- 删除 `created_by_user_id` 残留

### 验收标准

- `rg "created_by_user_id" backend/app` 不再存在

## A3. 清理 `SavedShare.task_id` 残留

### 当前问题

`SavedShare` 模型已经没有 `task_id`，但 service 和 schema 仍然在使用这个字段。

相关文件：

- [share.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/models/share.py#L35)
- [share_service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/services/share_service.py#L500)
- [share_service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/services/share_service.py#L502)
- [share.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/schemas/share.py#L32)
- [share.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/schemas/share.py#L36)

### 第一阶段动作

- 从 `share_service.py` 中移除 `SavedShare(task_id=...)`
- 更新 `schemas/share.py`，删除 `SavedShare.task_id`
- 审查所有 `SavedShare` 读取逻辑，改为通过 `share.task_id` 间接获取

### 验收标准

- `SavedShare` 的创建与 schema 字段都与模型一致
- 不再直接引用不存在的 `task_id`

## B. 修正模型与 schema 的漂移

第一阶段不要求把所有 schema 都模块化，但要求 schema 至少与当前实体一致。

## B1. 修正 `schemas/user.py`

### 当前问题

[user.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/schemas/user.py#L38) 暴露了 `password_hash` 相关结构，说明 schema 仍混合了“返回给前端的数据”和“数据库内部数据”。

### 第一阶段动作

- 明确哪些 schema 用于 API 输入输出
- 哪些 schema 仅用于内部使用
- 避免把数据库内部字段暴露为默认 API 模型

### 建议

第一阶段不一定重写所有 schema，但至少要：

- 将“返回给前端”的 schema 与 “DB 内部结构” 注释明确区分
- 防止 future API 误用内部 schema

## B2. 修正 `schemas/share.py`

### 当前问题

`schemas/share.py` 仍带有旧设计，例如 `SavedShare.task_id`。

### 第一阶段动作

- 让 `Share`、`SavedShare` schema 与现有 model 保持一致
- 删掉已无效字段

### 验收标准

- schema 字段与 model 字段能一一对应或有明确注释解释差异

## B3. 整理 `schemas/task.py`

### 当前问题

[task.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/schemas/task.py) 中仍有旧式 `TaskInDBBase.status` 字段，但当前实体更核心的是 `state / progress / current_step / error`。

另外：

- [worker_task_service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/services/worker_task_service.py#L43) 在创建 `Task` 时写入 `status='等待处理...'`
- 但 `Task` 模型 [task.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/models/task.py) 并没有 `status` 字段

### 第一阶段动作

- 清理 `schemas/task.py` 中与现有 Task 模型不匹配的字段
- 修复 `worker_task_service.py` 对不存在字段 `status` 的写入

### 验收标准

- `Task` 创建、更新、查询只使用现有模型字段
- 不再向 ORM 模型写入不存在的字段

## C. 修正错误码和权限引用

## C1. 修正不存在的错误码引用

### 当前问题

部分代码仍在引用不存在或不一致的错误码，例如：

- [task_service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/services/task_service.py#L184)
- [xml_service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/services/xml_service.py#L80)

这里使用了 `ErrorCode.NO_VIEW_ACCESS`，但当前错误码定义中并没有这个常量。

相关文件：

- [task_service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/services/task_service.py#L184)
- [xml_service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/services/xml_service.py#L80)
- [error_codes.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/constants/error_codes.py)

### 第一阶段动作

二选一：

- 要么补充 `NO_VIEW_ACCESS`
- 要么全部统一改为现有的 `NO_ACCESS`

更建议统一到现有错误码体系，不再引入新旧并存名称。

### 验收标准

- 所有 `ErrorCode.*` 引用都能在定义处找到

## C2. 校验权限依赖逻辑

### 当前问题

`deps.py` 中权限依赖既有用户鉴权，也有任务/分享权限判断，但存在旧字段残留。

相关文件：

- [deps.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/api/deps.py)
- [permissions.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/utils/permissions.py)

### 第一阶段动作

- 先修正依赖中的错误字段引用
- 不在第一阶段迁移目录
- 保持权限逻辑行为不变

### 验收标准

- `deps.py` 中所有 ORM 字段访问都与模型一致

## D. 统一路由层中的 schema 使用方式

第一阶段不迁模块，但先把“schema 来源不统一”这个问题收敛。

## D1. 去掉 endpoint 内联 schema

### 当前问题

[shares.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/api/endpoints/shares.py#L32) 直接在路由文件里定义了 `CreateShareRequest`。

### 第一阶段动作

- 将 `CreateShareRequest` 移入 `schemas/share.py`
- 让 endpoint 只导入 schema

### 验收标准

- 路由文件中不再直接声明 `BaseModel`

## D2. 统一 auth 相关请求模型使用

### 当前问题

`auth.py` 中已经有较完整的 schema，但部分接口仍混合使用：

- `OAuth2PasswordRequestForm`
- `Body(...)`
- 局部请求字段

### 第一阶段动作

这一阶段不强行全部重写认证接口，但要做到：

- 请求模型命名统一
- 验证码相关接口尽量使用已有 schema

### 验收标准

- `auth` 路由层不再继续引入新的匿名输入结构

## E. 修复 Worker 与任务域的明显不一致

第一阶段不拆目录，但必须把 worker 相关的明显错误修正掉。

## E1. 修正 `worker_task_service.py` 写入不存在字段

### 当前问题

[worker_task_service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/services/worker_task_service.py#L43) 写入了 `status='等待处理...'`，但当前 `Task` 模型没有 `status` 字段。

### 第一阶段动作

- 删除对不存在字段 `status` 的写入
- 统一任务创建状态依赖 `state / progress / current_step`

### 验收标准

- `SyncTaskService.create_task()` 只写模型真实存在的字段

## E2. 审核 Worker 专用 service 的边界注释

### 当前问题

`worker_task_service.py` 本质上是 Worker 专用同步持久化服务，但名字和职责容易与业务 service 混淆。

### 第一阶段动作

本阶段不改文件位置，但建议：

- 为 `worker_task_service.py` 添加更明确的模块注释
- 明确它是“过渡期 Worker 同步服务”

### 目的

为第二阶段迁移到 `modules/tasks/worker_service.py` 做准备。

## F. 为第二阶段目录迁移做最小准备

第一阶段不引入完整 `modules/`，但可以做两件低风险准备。

## F1. 引入 `api/v1/router.py`

### 当前问题

[main.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/main.py#L148) 到 [main.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/main.py#L153) 逐个手工注册路由。

### 第一阶段动作

- 新建 `app/api/v1/router.py`
- 把现有路由注册集中进去
- `main.py` 只引入总路由

### 说明

这一步是第一阶段唯一推荐进行的小型结构优化，因为：

- 风险低
- 收益高
- 能为第二阶段模块迁移提供稳定接入点

### 验收标准

- `main.py` 不再直接逐个导入 endpoint 模块

## F2. 给目录迁移留出命名标准

### 第一阶段动作

在文档和代码注释中先约定未来模块名：

- `auth`
- `tasks`
- `shares`
- `files`
- `profile`
- `xml`

并约定文件命名标准：

- `router.py`
- `schemas.py`
- `service.py`
- `repository.py`
- `worker_service.py`

### 说明

这一步不改目录，但会降低第二阶段的决策成本。

## G. 补基础验证手段

第一阶段至少要建立最小验证方式，否则后续迁移风险会很高。

## G1. 建立最小回归检查清单

即使这一阶段还没有完整测试目录，也建议至少人工或脚本验证以下流程：

- 登录
- 注册
- 修改密码
- 文件上传
- 提交任务
- 查看任务详情
- 创建分享
- 保存分享
- 加载 XML
- 保存 XML

### 第一阶段动作

- 在文档中记录最小回归用例
- 如果可以，补一个简单的 smoke 测试脚本

## G2. 为后续测试目录做准备

第一阶段不必一次性补齐所有测试，但建议：

- 新建 `app/tests/` 空目录
- 或至少在文档中定义未来测试分层

如果希望第一阶段尽量少动目录，也可以先只写文档，不立即创建测试目录。

## 第一阶段推荐实施顺序

建议按下面顺序执行，尽量减少连锁影响。

### 第 1 步：修字段命名漂移

先修：

- `hashed_password`
- `created_by_user_id`
- `SavedShare.task_id`
- `Task.status`

### 第 2 步：修 schema 与 model 不一致

重点修：

- `schemas/share.py`
- `schemas/task.py`
- `schemas/user.py`

### 第 3 步：修错误码与权限依赖

重点修：

- `ErrorCode` 引用
- `deps.py`
- `permissions.py`

### 第 4 步：去除路由层内联 schema

重点修：

- `api/endpoints/shares.py`

### 第 5 步：引入 `api/v1/router.py`

这是第一阶段唯一建议做的轻量结构调整。

## 第一阶段完成后的预期状态

完成第一阶段后，项目应具备以下特征：

- 命名统一，不再有明显旧字段残留
- schema 和 model 关系更清晰
- endpoint/service/worker 中的关键错误引用已清理
- `main.py` 更薄
- 目录虽然还没全面进入混合模式，但已经具备迁移条件

也就是说，第一阶段结束时，你的项目还不会长成最终的混合模式结构，但会达到一个非常关键的状态：

**它已经足够稳定，可以开始做第二阶段的模块化迁移，而不会边迁边踩旧契约的坑。**

## 第一阶段的完成判定

只有满足以下条件，才算第一阶段完成：

1. 不存在旧字段名引用
2. 不存在写入 ORM 不存在字段的逻辑
3. 不存在 schema 继续依赖已删除字段的情况
4. 所有 `ErrorCode` 引用可追踪
5. `main.py` 通过总路由注册接口

如果这五条还没满足，就不建议贸然进入第二阶段。

## 最终建议

第一阶段的核心不是“重构得多漂亮”，而是“让后续重构不失控”。

因此建议你把第一阶段严格限制为三类动作：

- 修契约
- 修引用
- 建桥梁

其中：

- 修契约：字段、schema、错误码统一
- 修引用：清理旧逻辑、旧命名、错误依赖
- 建桥梁：引入 `api/v1/router.py`，为第二阶段模块迁移铺路

这会是当前项目从“有分层雏形”走向“稳定混合模式架构”的最稳妥起点。


