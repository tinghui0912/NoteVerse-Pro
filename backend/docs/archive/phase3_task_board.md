# Phase 3 可打勾任务表

## 使用方式

- 按顺序推进，尽量不要跨组并行大改。
- 每完成一项就打勾。
- 每组结束后至少做一次编译检查。
- 每个模块完成“真实拆分”后，再进入下一个模块。

---

## A. 阶段准备

- [ ] 确认 [phase2_status_summary.md](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/docs/archive/phase2_status_summary.md) 作为 Phase 2 阶段结论，不再继续追加零散 Phase 2 改动
- [ ] 在本轮开始前记录当前 Phase 3 范围：`shares -> xml -> profile -> services 清理 -> shared 评估 -> smoke/test`
- [ ] 先运行一轮针对核心模块文件的 `py_compile`，确认当前基线可用

---

## B. Shares 真拆分

### B1. 路由与入口收口

- [ ] 检查 [router.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/modules/shares/router.py) 是否仍只是旧 endpoint 转发
- [ ] 将 `shares` 路由真实迁入模块目录，而不是只从旧 `api/endpoints/shares.py` 转发
- [ ] 确认 [router.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/api/v1/router.py) 不需要调整外部接入方式

### B2. Service 真拆分

- [ ] 评估 [share_service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/services/share_service.py) 的职责边界
- [ ] 将核心分享业务逻辑迁入 [service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/modules/shares/service.py)
- [ ] 让旧 [share_service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/services/share_service.py) 降级为兼容层或明确保留策略

### B3. Repository 下沉

- [ ] 在 [repository.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/modules/shares/repository.py) 建立真实查询接口
- [ ] 抽离 share 查询
- [ ] 抽离 saved share 查询
- [ ] 抽离 share 删除/批量删除相关数据访问
- [ ] 抽离 share 下载前校验相关数据访问

### B4. Schema 收口

- [ ] 检查 [schemas.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/modules/shares/schemas.py) 是否仍只是 `re-export`
- [ ] 评估是否将 `app/schemas/share.py` 物理迁入模块
- [ ] 统一 `shares` 模块请求/响应 schema 的最终归属

### B5. 验证

- [ ] 对 `shares` 模块相关文件执行 `py_compile`
- [ ] 检查 `shares` 路由、依赖、service、repository 的 import 是否都优先走 `app.modules.shares`
- [ ] 补一份 `shares` 深拆进度文档

---

## C. XML 真拆分

### C1. 路由与入口收口

- [ ] 检查 [router.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/modules/xml/router.py) 是否仍只是旧 endpoint 转发
- [ ] 将 XML 路由真实迁入模块目录

### C2. Service 真拆分

- [ ] 评估 [xml_service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/services/xml_service.py) 内哪些是业务逻辑，哪些是底层文件/渲染协作
- [ ] 将 XML 业务逻辑迁入 [service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/modules/xml/service.py)
- [ ] 确定哪些底层协作继续保留在 `processing/` 或 `files` 模块，不要把平台能力硬塞回 XML 模块
- [ ] 让旧 [xml_service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/services/xml_service.py) 降级为兼容层或明确保留策略

### C3. Schema 收口

- [ ] 检查 [schemas.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/modules/xml/schemas.py) 是否仍只是 `re-export`
- [ ] 评估是否将 `app/schemas/xml.py` 物理迁入模块
- [ ] 统一 XML 模块 schema 归属

### C4. 验证

- [ ] 对 `xml` 模块相关文件执行 `py_compile`
- [ ] 检查 XML 路由和依赖是否优先走 `app.modules.xml`
- [ ] 补一份 `xml` 深拆进度文档

---

## D. Profile 真拆分

### D1. 路由与入口收口

- [ ] 检查 [router.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/modules/profile/router.py) 是否仍只是旧 endpoint 转发
- [ ] 将 profile 路由真实迁入模块目录

### D2. Service 真拆分

- [ ] 评估 [avatar_service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/services/avatar_service.py) 与 profile 业务的关系
- [ ] 将头像处理能力迁入 [service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/modules/profile/service.py) 或拆成模块内 `avatar_service.py`
- [ ] 明确“资料修改 / 密码修改 / 头像处理”的职责边界
- [ ] 让旧 [avatar_service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/services/avatar_service.py) 降级为兼容层或明确保留策略

### D3. Schema 收口

- [ ] 检查 [schemas.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/modules/profile/schemas.py) 是否仍只是 `re-export`
- [ ] 评估是否将 `app/schemas/profile.py` 物理迁入模块
- [ ] 统一 profile 模块 schema 归属

### D4. 验证

- [ ] 对 `profile` 模块相关文件执行 `py_compile`
- [ ] 检查 profile 路由和依赖是否优先走 `app.modules.profile`
- [ ] 补一份 `profile` 深拆进度文档

---

## E. Auth 收口复查

- [ ] 检查 [router.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/modules/auth/router.py) 是否仍只是旧 endpoint 转发
- [ ] 检查 [schemas.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/modules/auth/schemas.py) 是否仍只是 `re-export`
- [ ] 判断 `auth` 是否需要进入真实拆分，还是暂时保持公共层复用
- [ ] 如果暂不深拆，补一份明确说明文档，记录为什么 `auth` 暂缓

---

## F. 旧 Services 目录清理

### F1. 兼容层策略确认

- [ ] 列出 `app/services/` 下所有文件的当前角色：真实实现 / 兼容层 / 待退役
- [ ] 明确 `task_service.py` 和 `worker_task_service.py` 已属于兼容层
- [ ] 明确 `share_service.py`、`xml_service.py`、`avatar_service.py`、`file_service.py` 的目标状态

### F2. 清理执行

- [ ] 把已完成迁移的旧 service 文件改为统一兼容写法
- [ ] 删除不再需要的重复注释和误导性说明
- [ ] 检查是否还有调用方直接优先依赖旧 `app.services.*`
- [ ] 将可迁移的调用点逐步改为 `app.modules.*`

### F3. 验证

- [ ] 扫描项目内 `from app.services` 的引用分布
- [ ] 补一份 `services/` 清理状态文档

---

## G. Shared 层评估与启动

### G1. 响应层

- [ ] 评估 [response.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/schemas/response.py) 是否迁入 `app/shared/responses.py`
- [ ] 如果迁移，先保留兼容导出层，避免一次性破坏大量 import

### G2. 常量层

- [ ] 盘点 `app/constants/` 中哪些是纯共享常量
- [ ] 盘点哪些枚举与 ORM 强耦合，暂不迁移
- [ ] 决定是否启动 `app/shared/constants.py` / `app/shared/enums.py`

### G3. 结论

- [ ] 补一份 `shared` 层评估结论文档

---

## H. Smoke 与测试闭环

### H1. Smoke

- [ ] 按模块至少执行一轮核心路由 smoke 检查
- [ ] 验证 `tasks` 核心链路
- [ ] 验证 `files` 上传/下载/导出链路
- [ ] 验证 `shares` 创建/访问/保存链路
- [ ] 验证 `xml` 加载/保存/确认链路
- [ ] 验证 `profile` 修改资料/头像链路

### H2. 自动化测试

- [ ] 评估当前是否已有 `tests/` 基线可复用
- [ ] 补最小化回归测试优先集
- [ ] 至少覆盖一个 `tasks` 用例
- [ ] 至少覆盖一个 `files` 用例
- [ ] 至少覆盖一个 `shares` 或 `xml` 用例

---

## I. Phase 3 完成判定

- [ ] `shares` 已不再只是包装层
- [ ] `xml` 已不再只是包装层
- [ ] `profile` 已不再只是包装层
- [ ] `files` 的 service/repository 边界稳定
- [ ] `services/` 目录角色已经明确
- [ ] `api/deps.py` 保持公共层和兼容转发的轻量状态
- [ ] 至少完成一轮 smoke 验收
- [ ] Phase 3 总结文档已补齐

