# 第一阶段重构任务表

## 使用说明

这份文档是 [phase1_refactor_checklist.md](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/docs/archive/phase1_refactor_checklist.md) 的执行版。

用途：

- 作为第一阶段重构的打勾清单
- 作为团队分工用任务板
- 作为阶段验收记录

建议使用方式：

- 每完成一项，就把 `- [ ]` 改成 `- [x]`
- 每个任务尽量单独提交或单独验证
- 遇到阻塞，在任务下补一句备注

## 第一阶段目标

- 统一实体契约
- 清理旧字段和错误引用
- 收敛 schema 漂移
- 引入总路由聚合点
- 为第二阶段混合模式迁移铺路

## 任务 1：统一 `User` 密码字段命名

- [ ] 确认 [user.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/models/user.py#L25) 中 `password_hash` 作为唯一密码字段名
- [ ] 检查 [profile.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/api/endpoints/profile.py#L91) 是否仍使用 `hashed_password`
- [ ] 检查 [profile.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/api/endpoints/profile.py#L97) 是否仍写入 `hashed_password`
- [ ] 将所有 `hashed_password` 引用统一改为 `password_hash`
- [ ] 全局搜索 `rg "hashed_password" backend/app`，确认业务代码中已无残留
- [ ] 验证登录逻辑仍正常
- [ ] 验证修改密码逻辑仍正常

## 任务 2：统一 `Share` 所有者字段命名

- [ ] 确认 [share.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/models/share.py#L21) 中 `owner_user_id` 为唯一所有者字段
- [ ] 检查 [deps.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/api/deps.py#L113) 是否仍使用 `created_by_user_id`
- [ ] 将 `created_by_user_id` 全部改为 `owner_user_id`
- [ ] 全局搜索 `rg "created_by_user_id" backend/app`，确认无残留
- [ ] 验证分享删除权限逻辑正常
- [ ] 验证分享归属判断逻辑正常

## 任务 3：清理 `SavedShare.task_id` 残留

- [ ] 确认 [share.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/models/share.py#L35) 的 `SavedShare` 模型不包含 `task_id`
- [ ] 检查 [share_service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/services/share_service.py#L500) 到 [share_service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/services/share_service.py#L503) 是否仍创建 `SavedShare(task_id=...)`
- [ ] 删除 `SavedShare` 创建逻辑中的 `task_id`
- [ ] 检查 [share.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/schemas/share.py#L32) 到 [share.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/schemas/share.py#L37) 是否仍保留 `task_id`
- [ ] 从 `schemas/share.py` 中删除 `SavedShare.task_id`
- [ ] 检查所有读取 `SavedShare.task_id` 的代码，改为通过 `share.task_id` 间接获取
- [ ] 全局搜索 `rg "SavedShare.*task_id|task_id=share.task_id|task_id: int" backend/app`，确认残留已清理
- [ ] 验证“收藏分享”功能正常
- [ ] 验证“我的收藏分享列表”功能正常

## 任务 4：修复 `Task.status` 漂移

- [ ] 检查 [task.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/models/task.py) 中 `Task` 是否存在 `status` 字段
- [ ] 检查 [worker_task_service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/services/worker_task_service.py#L43) 是否仍写入 `status='等待处理...'`
- [ ] 删除 `SyncTaskService.create_task()` 中对不存在字段 `status` 的写入
- [ ] 检查 [task.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/schemas/task.py#L45) 到 [task.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/schemas/task.py#L54) 中 `status` 字段是否需要保留
- [ ] 若保留 `status` 为 API 概念，补注释说明其不是 ORM 字段
- [ ] 若不保留，移除 schema 中的 `status`
- [ ] 验证任务创建逻辑正常
- [ ] 验证任务详情查询逻辑正常

## 任务 5：修复错误码引用不一致

- [ ] 检查 [task_service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/services/task_service.py#L184) 是否仍引用 `ErrorCode.NO_VIEW_ACCESS`
- [ ] 检查 [xml_service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/services/xml_service.py#L80) 是否仍引用 `ErrorCode.NO_VIEW_ACCESS`
- [ ] 对照 [error_codes.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/constants/error_codes.py) 确认当前可用错误码
- [ ] 决定统一策略：补 `NO_VIEW_ACCESS` 或统一改为 `NO_ACCESS`
- [ ] 按统一策略修复所有错误码引用
- [ ] 全局搜索 `rg "NO_VIEW_ACCESS" backend/app`，确认无悬空引用
- [ ] 抽查 403/404/422 场景响应结构是否仍符合预期

## 任务 6：修复 `deps.py` 中的旧字段与依赖漂移

- [ ] 检查 [deps.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/api/deps.py) 中所有 ORM 字段访问
- [ ] 修复分享所有权校验中旧字段残留
- [ ] 审查 `get_current_user()` 返回对象字段使用是否与 `User` 模型一致
- [ ] 审查 `get_current_active_superuser()` 的 role 判断逻辑是否一致
- [ ] 审查任务查看/编辑权限依赖是否继续可用
- [ ] 验证需要登录的接口仍可正常鉴权

## 任务 7：修复 `schemas/share.py`

- [ ] 审查 [share.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/schemas/share.py) 中所有字段
- [ ] 删除与当前 model 不一致的字段
- [ ] 确认 `Share` schema 与 `Share` model 主要字段一致
- [ ] 确认 `SavedShare` schema 与 `SavedShare` model 主要字段一致
- [ ] 确认输出 schema 不暴露无效字段
- [ ] 验证分享相关接口返回结构符合预期

## 任务 8：整理 `schemas/task.py`

- [ ] 审查 [task.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/schemas/task.py) 中请求模型与返回模型
- [ ] 标记哪些 schema 仅用于 API 输入
- [ ] 标记哪些 schema 仅用于内部使用
- [ ] 清理与 ORM 实体不一致、且没有业务价值的字段
- [ ] 确认 `BatchSubmitRequest` 与 `TaskUpdateRequest` 可继续直接用于 API
- [ ] 验证任务提交接口仍正常
- [ ] 验证任务更新接口仍正常

## 任务 9：整理 `schemas/user.py`

- [ ] 审查 [user.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/schemas/user.py) 的用途划分
- [ ] 确认 `User` 返回模型不会误暴露内部字段
- [ ] 确认 `UserInDB` 仅用于内部使用
- [ ] 为内部 schema 添加注释说明，避免后续误用
- [ ] 验证注册接口返回结构正常

## 任务 10：去除路由层内联 schema

- [ ] 检查 [shares.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/api/endpoints/shares.py#L32) 内联的 `CreateShareRequest`
- [ ] 将 `CreateShareRequest` 移入 [share.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/schemas/share.py)
- [ ] 让 `shares.py` 只导入 schema，不再定义 `BaseModel`
- [ ] 全局搜索路由层中的 `class .*\\(BaseModel\\)`，确认是否还有其他内联 schema
- [ ] 如有其他内联 schema，记录但非必要项可延后
- [ ] 验证创建分享接口正常

## 任务 11：收敛认证接口输入结构

- [ ] 审查 [auth.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/api/endpoints/auth.py) 中请求参数来源
- [ ] 确认验证码发送接口使用 [auth.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/schemas/auth.py) 中的 `SendCodeRequest`
- [ ] 评估验证码校验接口是否可复用已有 schema
- [ ] 评估重置密码接口是否已统一使用 schema
- [ ] 第一阶段避免新增新的匿名 Body 结构
- [ ] 验证注册、登录、验证码、重置密码接口正常

## 任务 12：为 Worker 专用 service 补过渡注释

- [ ] 检查 [worker_task_service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/services/worker_task_service.py) 文件头注释
- [ ] 明确标注该文件是“过渡期 Worker 专用同步服务”
- [ ] 明确标注未来目标位置是 `modules/tasks/worker_service.py` 或 `modules/tasks/repository.py`
- [ ] 补充该文件不应被普通 API 层直接依赖的说明

## 任务 13：引入 `api/v1/router.py`

- [ ] 新建 `app/api/v1/router.py`
- [ ] 将当前所有路由注册集中到该文件
- [ ] 检查 [main.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/main.py#L148) 到 [main.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/main.py#L153) 的逐个 `include_router`
- [ ] 将 `main.py` 改为只引入总路由对象
- [ ] 保持现有 URL 前缀不变
- [ ] 保持现有 tags 不变
- [ ] 验证 `/docs` 中路由仍完整显示

## 任务 14：让 `main.py` 更薄

- [ ] 审查 [main.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/main.py) 中应用启动逻辑
- [ ] 保持第一阶段只做轻量整理，不拆过多函数
- [ ] 至少做到路由注册不再散落在 `main.py`
- [ ] 确认中间件、静态文件、异常处理不受影响
- [ ] 验证应用启动正常

## 任务 15：建立最小回归验证清单

- [ ] 记录登录接口验证步骤
- [ ] 记录注册接口验证步骤
- [ ] 记录修改密码接口验证步骤
- [ ] 记录文件上传接口验证步骤
- [ ] 记录任务提交接口验证步骤
- [ ] 记录任务详情接口验证步骤
- [ ] 记录创建分享接口验证步骤
- [ ] 记录保存分享接口验证步骤
- [ ] 记录加载 XML 接口验证步骤
- [ ] 记录保存 XML 接口验证步骤

## 任务 16：补一个最小 smoke 验证方案

- [ ] 选择验证方式：手工验证或简单脚本验证
- [ ] 如果用脚本，先只覆盖核心 happy path
- [ ] 把 smoke 验证步骤记录到文档或脚本注释中
- [ ] 确保第一阶段结束前至少执行一轮完整验证

## 任务 17：为第二阶段模块迁移预留命名标准

- [ ] 在文档中确认未来模块名：`auth / tasks / shares / files / profile / xml`
- [ ] 在文档中确认未来文件命名：`router.py / schemas.py / service.py / repository.py / worker_service.py`
- [ ] 确认团队后续新增代码不再继续扩张 `api/endpoints + schemas + services` 的旧模式

## 建议执行顺序

按下面顺序推进最稳：

- [ ] 先做任务 1
- [ ] 再做任务 2
- [ ] 再做任务 3
- [ ] 再做任务 4
- [ ] 再做任务 5
- [ ] 再做任务 6
- [ ] 再做任务 7
- [ ] 再做任务 8
- [ ] 再做任务 9
- [ ] 再做任务 10
- [ ] 再做任务 11
- [ ] 再做任务 12
- [ ] 再做任务 13
- [ ] 再做任务 14
- [ ] 再做任务 15
- [ ] 再做任务 16
- [ ] 最后做任务 17

## 第一阶段完成判定

以下项目全部勾完，才算第一阶段完成：

- [ ] 旧字段名残留已全部清理
- [ ] schema 与 model 的关键漂移已收敛
- [ ] 不再写入 ORM 不存在字段
- [ ] 所有错误码引用有效
- [ ] `main.py` 通过总路由注册接口
- [ ] 至少完成一轮最小回归验证

## 备注区

- [ ] 记录阻塞项
- [ ] 记录需要延后到第二阶段的内容
- [ ] 记录重构过程中发现的新契约漂移问题


