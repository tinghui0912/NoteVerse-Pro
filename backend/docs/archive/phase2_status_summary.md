# Phase 2 阶段性总结

## 文档目的

这份文档用于回顾当前 Phase 2 的结构改造完成度，明确三件事：

- 已完成了什么
- 还没有完成什么
- 下一阶段最值得做什么

目标不是重复所有过程记录，而是给出一份可以直接指导后续工作的阶段性结论。

## 当前总体判断

**Phase 2 已经完成了“目录边界建立”和“部分核心模块真实拆分”两件关键工作，但还没有完成“模块内彻底去旧路径”和“全项目统一收口”。**

换句话说，项目现在已经明显从传统 `api/schemas/services` 纯技术分层，走到了推荐的混合模式骨架上，但仍处在：

- 模块入口基本稳定
- 部分模块已深入拆分
- 部分模块仍是兼容包装层
- 公共共享层尚未统一收口

## 一、已完成

### 1. 顶层混合模式骨架已经建立

以下结构已经实际存在并接入运行路径：

- `app/db/`
- `app/modules/`
- `app/api/v1/router.py`

当前 `modules/` 下已经有：

- `auth`
- `files`
- `profile`
- `shares`
- `tasks`
- `xml`

而 [router.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/api/v1/router.py) 已经统一从 `app.modules.*` 接路由，不再直接在 `main.py` 里逐个拼接旧 endpoint。

### 2. `api/deps.py` 已经瘦身成功

[deps.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/api/deps.py) 现在已经基本收敛为：

- 公共认证依赖
- 公共数据库依赖
- 向各 feature module 转发的兼容入口

已经完成模块级依赖收口的有：

- `tasks`
- `shares`
- `profile`
- `xml`
- `files`

对应依赖文件包括：

- [dependencies.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/modules/tasks/dependencies.py)
- [dependencies.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/modules/shares/dependencies.py)
- [dependencies.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/modules/profile/dependencies.py)
- [dependencies.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/modules/xml/dependencies.py)
- [dependencies.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/modules/files/dependencies.py)

### 3. `tasks` 已经进入真实拆分阶段

`tasks` 不是只有包装入口，而是已经开始拥有真实的模块边界：

- [service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/modules/tasks/service.py)
- [worker_service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/modules/tasks/worker_service.py)
- [repository.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/modules/tasks/repository.py)
- [dependencies.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/modules/tasks/dependencies.py)

并且旧路径：

- [task_service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/services/task_service.py)
- [worker_task_service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/services/worker_task_service.py)

已经降级为兼容层。

### 4. `files` 已经进入真实拆分阶段

`files` 目前是 Phase 2 里拆得最完整的模块之一。

已经具备：

- [service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/modules/files/service.py)
- [repository.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/modules/files/repository.py)
- [dependencies.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/modules/files/dependencies.py)

而且以下逻辑已经从路由层收进模块：

- 上传与去重
- 按任务列文件
- 下载
- 删除上传文件
- preview
- Excel 导出

[files.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/api/endpoints/files.py) 现在基本已经是 HTTP 适配层。

### 5. 数据库入口已经完成第一轮收口

已经存在新的数据库入口：

- [session.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/db/session.py)
- [worker_session.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/db/worker_session.py)

并且旧入口已经做成兼容层：

- [db.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/core/db.py)
- [db.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/worker/db.py)

### 6. Phase 1 暴露出的关键契约漂移问题已处理

这一块虽然属于 Phase 1 收尾，但它是 Phase 2 能继续推进的前提。当前已经完成过：

- 用户密码字段命名统一
- share 所有者字段统一
- `SavedShare` 残留字段清理
- 匿名 body schema 收口
- 路由聚合与 schema 收口

## 二、未完成

### 1. 模块 `router.py` 仍大多是兼容包装层

当前很多模块路由文件本质上仍是这样：

- `from app.api.endpoints.xxx import router`

例如：

- [router.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/modules/auth/router.py)
- [router.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/modules/files/router.py)
- [router.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/modules/shares/router.py)
- [router.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/modules/tasks/router.py)

这说明：

- 路由接入路径已经模块化
- 但真正的路由文件物理迁移还没完成

### 2. 模块 `schemas.py` 仍大多是 re-export 包装层

当前很多模块 schema 文件仍是：

- `from app.schemas.xxx import *`

例如：

- [schemas.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/modules/auth/schemas.py)
- [schemas.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/modules/tasks/schemas.py)
- [schemas.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/modules/shares/schemas.py)
- [schemas.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/modules/files/schemas.py)

这说明 schema 命名边界已经有了，但物理归位还没完成。

### 3. `shares / profile / xml` 仍主要停留在服务包装阶段

当前这几个模块虽然有 `dependencies.py`，但 `service.py` 基本仍只是转发旧服务：

- [service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/modules/shares/service.py)
- [service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/modules/profile/service.py)
- [service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/modules/xml/service.py)

也就是说：

- 这些模块已经拥有模块边界
- 但还没有像 `tasks/files` 那样完成真实内部拆分

### 4. `services/` 目录还没有完成第二轮清理

目前 `services/` 目录里仍保留不少旧实现：

- [share_service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/services/share_service.py)
- [avatar_service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/services/avatar_service.py)
- [xml_service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/services/xml_service.py)
- [file_service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/services/file_service.py)

其中：

- `task_service.py` / `worker_task_service.py` 已基本完成兼容化
- 但 `share/xml/avatar/file` 还没有统一降级成兼容层或进一步迁移

### 5. `files` 虽然已拆得较深，但仍未完全收口

`files` 目前已经很接近目标形态，但还留有几个未彻底完成的点：

- `FilesService` 仍承担部分数据整形职责
- `preview` 虽已进 service，但仍偏直接文件响应准备
- `file_service.py` 旧路径仍未统一定位成“保留/兼容/删除”之一

### 6. 共享层 `shared/` 还没有启动

迁移方案里提到的这些内容，目前还没有真正开始：

- `shared/responses.py`
- `shared/constants.py`
- `shared/enums.py`

当前项目依然主要使用：

- `app/schemas/response.py`
- `app/constants/`

### 7. `models/` 仍未做进一步策略确认

当前 `models/` 继续保留是合理的，但仍没有形成阶段结论：

- 是长期保留 `models/`
- 还是未来改为 `domain/`

目前这部分仍处于“先不动”的状态。

### 8. 验收闭环还不完整

虽然多轮 `py_compile` 已经做了，但以下仍未形成完整闭环：

- 一轮系统性的 smoke 验证
- 路由联调验收
- 关键业务链路实际跑通记录
- 测试目录和自动化测试补齐

也就是说，当前完成度更偏“结构迁移完成度”，还不是“工程验收完成度”。

## 三、当前完成度判断

如果把 Phase 2 粗分成三层，可以这样判断：

### 第一层：骨架层

**完成度高，接近完成。**

包括：

- `db/`
- `modules/`
- `api/v1/router.py`
- `api/deps.py` 收口

### 第二层：模块边界层

**完成度中高。**

包括：

- 所有核心业务域都已有模块入口
- 所有核心业务域都已有模块依赖入口
- 但大量 router/schema 仍是包装层

### 第三层：模块内部真实拆分层

**完成度中等。**

当前状态大致是：

- `tasks`：已开始真实拆分
- `files`：已明显进入真实拆分
- `shares`：主要还是包装
- `profile`：主要还是包装
- `xml`：主要还是包装
- `auth`：仍偏包装/公共依赖复用

## 四、下一阶段建议

### 建议 1：先做一次 Phase 2 阶段冻结，而不是继续无止境拆下去

现在最需要的不是继续零散拆文件，而是先明确：

- Phase 2 到这里算不算一个可验收的阶段
- 哪些内容进入 Phase 3

建议先把当前状态冻结成一个里程碑。

### 建议 2：下一阶段优先级应从“补骨架”切换为“深拆少数模块”

下一阶段不要再平均推进所有模块，而应该聚焦少数收益最大的目标：

#### 优先组 A

- `shares`
- `xml`
- `profile`

目标是把它们从“包装层模块”推进成“真实模块”。

#### 优先组 B

- `services/` 旧路径清理

目标是统一明确：

- 哪些文件保留为兼容层
- 哪些文件继续承载真实实现
- 哪些文件应该退役

### 建议 3：如果只选一个模块作为下一阶段重点，优先做 `shares`

原因：

- 它比 `tasks` 简单
- 比 `profile` 更有明显 service/repository 拆分价值
- 又和 `tasks/files` 有边界协作，适合验证当前混合模式是否真正稳定

推荐顺序：

1. `shares`
2. `xml`
3. `profile`
4. `auth`

### 建议 4：补一份 Phase 3 可打勾任务表

下一阶段最适合从“按模块推进”的执行清单开始，而不是继续散点重构。

建议新的任务表至少包含：

- `shares` 真拆分
- `xml` 真拆分
- `profile` 真拆分
- `services/` 旧路径清理
- `shared/` 是否启动
- smoke 验收
- 自动化测试补位

## 五、结论

当前 Phase 2 可以概括成一句话：

**混合模式的骨架已经搭成，`tasks/files` 已进入真实模块化阶段，但 `shares/profile/xml/auth` 还需要从“模块包装层”继续演进到“模块实现层”。**

如果从工程推进角度判断，现在最合理的做法不是继续平均推进所有目录，而是：

- 先确认 Phase 2 的阶段性完成边界
- 再以 `shares -> xml -> profile` 的顺序进入下一阶段深拆
- 同时补验收和测试闭环
