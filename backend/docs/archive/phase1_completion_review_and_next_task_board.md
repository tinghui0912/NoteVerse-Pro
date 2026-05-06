# 第 1 阶段完成度复盘与下一步任务表

日期：2026-03-25

## 结论

当前状态可以定义为：

- [x] 第 1 阶段核心代码重构已完成
- [ ] 第 1 阶段正式验收未完成

原因很明确：

- 关键契约漂移问题已经处理完
- 总路由聚合已经落地
- 主要请求模型收口已经完成
- 但最小 smoke 验证还没有实际执行
- `/docs` 和关键 happy path 还没有做联调验收
- 任务板本身还没有同步成已完成状态

所以更准确的判断是：

**第 1 阶段的“实现”基本完成，但“验收”和“收尾”还没完成。**

## 已完成项

- [x] 统一 `User.password_hash`
- [x] 统一 `Share.owner_user_id`
- [x] 清理 `SavedShare.task_id` 历史残留
- [x] 移除对不存在的 `Task.status` 写入
- [x] 统一 `NO_VIEW_ACCESS` 错误码引用
- [x] 修正 `deps.py` 中分享归属字段漂移
- [x] 收口 `schemas/share.py`
- [x] 收口认证验证码相关请求 schema
- [x] 给 worker 专用同步 service 增加过渡期说明
- [x] 新增 `app/api/v1/router.py`
- [x] 让 `main.py` 通过总路由注册接口
- [x] 全量 `backend/app` 语法编译通过

## 尚未完成的第 1 阶段收尾项

这些项目建议在进入下一阶段前补完。

### A. 验证闭环还没完成

- [ ] 启动服务并实际执行一轮 smoke 验证
- [ ] 验证 `/docs` 分组和路由展示是否正常
- [ ] 验证认证链路是否正常
- [ ] 验证任务链路是否正常
- [ ] 验证分享链路是否正常
- [ ] 验证 XML 链路是否正常

### B. 文档状态还没回写

- [ ] 把 `phase1_refactor_task_board.md` 中已完成项勾选
- [ ] 把未完成项单独标注为“验收阶段”
- [ ] 在 `phase1_refactor_progress.md` 中补充验收结果

### C. 少量边界问题仍建议处理

- [ ] 复核 `get_current_active_superuser()` 的角色判断，统一使用 `UserRole.admin`
- [ ] 评估 `tasks.py` 和 `files.py` 中仍存在的匿名 `Body(...)` 输入是否要继续 schema 化
- [ ] 评估 `app/core/db.py` 是否作为下一阶段优先迁移对象

## 是否有遗漏步骤

有，但不多，主要是下面 4 类：

### 1. 缺少“执行验证”

第 1 阶段已经做了静态层验证，但还缺：

- [ ] 真实接口调用验证
- [ ] 认证 token 流程验证
- [ ] 分享权限验证
- [ ] XML 保存与读取验证

### 2. 缺少“任务板回写”

目前实际代码状态和任务板状态不同步：

- [ ] 任务板回填完成项
- [ ] 标记哪些是“代码已完成”
- [ ] 标记哪些是“待验收”

### 3. 缺少“第 2 阶段起步骨架”

虽然方向已经明确，但当前还没有真正落地：

- [ ] `app/db/`
- [ ] `app/modules/`
- [ ] 模块内标准命名骨架

### 4. 缺少“边界继续收口”

当前已经明显好转，但还没完全达到混合模式的起点：

- [ ] API 层仍然存在零散匿名 `Body(...)`
- [ ] `services/` 仍然是旧时代的集中目录
- [ ] `core/db.py` 仍然没有迁到 `db/`

## 接下来应该做什么

建议按下面顺序推进，不要直接大规模移动目录。

### 先做：第 1 阶段验收闭环

- [ ] 执行 `phase1_smoke_validation.md`
- [ ] 补齐验收记录
- [ ] 更新第 1 阶段任务板状态

### 再做：第 2 阶段的低风险起步

- [ ] 建立 `app/db/` 骨架
- [ ] 建立 `app/modules/` 骨架
- [ ] 先迁最轻模块：`auth`
- [ ] 再迁 `profile`
- [ ] 再迁 `shares`

### 最后做：中风险结构收口

- [ ] 处理 `files` 模块
- [ ] 处理 `xml` 模块
- [ ] 最后处理 `tasks` 模块
- [ ] 再拆 `repository.py / worker_service.py`

## 下一步可打勾任务表

下面这份任务表是“第 1 阶段收尾 + 第 2 阶段起步”的执行版。

## 任务 1：完成第 1 阶段验收

- [ ] 启动 FastAPI 服务
- [ ] 检查 `/docs`
- [ ] 执行 [phase1_smoke_validation.md](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/docs/archive/phase1_smoke_validation.md) 中的认证链路
- [ ] 执行 [phase1_smoke_validation.md](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/docs/archive/phase1_smoke_validation.md) 中的文件与任务链路
- [ ] 执行 [phase1_smoke_validation.md](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/docs/archive/phase1_smoke_validation.md) 中的分享链路
- [ ] 执行 [phase1_smoke_validation.md](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/docs/archive/phase1_smoke_validation.md) 中的 XML 链路
- [ ] 记录失败项和阻塞项

## 任务 2：同步第 1 阶段文档状态

- [ ] 更新 [phase1_refactor_task_board.md](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/docs/archive/phase1_refactor_task_board.md)
- [ ] 更新 [phase1_refactor_progress.md](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/docs/archive/phase1_refactor_progress.md)
- [ ] 明确标注“第 1 阶段已完成项”
- [ ] 明确标注“第 1 阶段验收待完成项”

## 任务 3：补齐第 1.5 阶段边界清理

- [ ] 检查 [deps.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/api/deps.py) 中 `get_current_active_superuser()` 的角色比较方式
- [ ] 如有必要，统一改为 `UserRole.admin`
- [ ] 检查 [tasks.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/api/endpoints/tasks.py) 中匿名 `Body(...)` 输入
- [ ] 检查 [files.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/api/endpoints/files.py) 中匿名 `Body(...)` 输入
- [ ] 记录哪些匿名 body 必须迁入 schema
- [ ] 记录哪些匿名 body 可以延后

## 任务 4：建立 `db/` 目标骨架

- [ ] 新建 `app/db/`
- [ ] 新建 `app/db/__init__.py`
- [ ] 新建 `app/db/session.py`
- [ ] 从 `app/core/db.py` 提炼异步 session 入口到 `app/db/session.py`
- [ ] 保持旧导入暂时兼容
- [ ] 验证 `get_db()` 依赖仍正常

## 任务 5：建立 `modules/` 目标骨架

- [ ] 新建 `app/modules/`
- [ ] 新建 `app/modules/__init__.py`
- [ ] 新建 `app/modules/auth/`
- [ ] 新建 `app/modules/profile/`
- [ ] 新建 `app/modules/shares/`
- [ ] 新建 `app/modules/files/`
- [ ] 新建 `app/modules/xml/`
- [ ] 新建 `app/modules/tasks/`

## 任务 6：迁移 `auth` 模块骨架

- [ ] 新建 `app/modules/auth/router.py`
- [ ] 新建 `app/modules/auth/schemas.py`
- [ ] 新建 `app/modules/auth/service.py`
- [ ] 从旧位置导入并保持兼容
- [ ] 让 `api/v1/router.py` 改为从 `modules/auth/router.py` 接入
- [ ] 验证登录、注册、验证码接口

## 任务 7：迁移 `profile` 模块骨架

- [ ] 新建 `app/modules/profile/router.py`
- [ ] 新建 `app/modules/profile/schemas.py`
- [ ] 新建 `app/modules/profile/service.py`
- [ ] 迁移头像相关 service 的目标归属说明
- [ ] 让 `api/v1/router.py` 改为从 `modules/profile/router.py` 接入
- [ ] 验证资料查询与修改密码接口

## 任务 8：迁移 `shares` 模块骨架

- [ ] 新建 `app/modules/shares/router.py`
- [ ] 新建 `app/modules/shares/schemas.py`
- [ ] 新建 `app/modules/shares/service.py`
- [ ] 新建 `app/modules/shares/repository.py`
- [ ] 让 `api/v1/router.py` 改为从 `modules/shares/router.py` 接入
- [ ] 验证分享创建、保存、批量删除接口

## 任务 9：为 `files / xml / tasks` 准备迁移前清单

- [ ] 盘点 `files` 与 `tasks` 的职责边界
- [ ] 盘点 `xml` 与 `files` 的职责边界
- [ ] 盘点 `tasks` 与 `worker/pipeline/processing` 的边界
- [ ] 标记哪些文件可直接迁移
- [ ] 标记哪些文件必须先拆分再迁移

## 第 2 阶段开始前的完成判定

满足下面条件后，再正式进入下一阶段主线迁移：

- [ ] 第 1 阶段 smoke 验证至少完成 1 轮
- [ ] 第 1 阶段任务板已回写
- [ ] `app/db/` 骨架已建立
- [ ] `app/modules/` 骨架已建立
- [ ] `auth / profile / shares` 至少有 1 个模块完成入口迁移示范


