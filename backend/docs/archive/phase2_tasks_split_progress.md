# 第 2 阶段 Tasks 真拆分进度

日期：2026-03-25

## 本轮完成

- [x] 将异步任务业务实现迁移到 [service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/modules/tasks/service.py)
- [x] 将 worker 同步任务实现迁移到 [worker_service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/modules/tasks/worker_service.py)
- [x] 将旧 [task_service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/services/task_service.py) 收敛为兼容包装层
- [x] 将旧 [worker_task_service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/services/worker_task_service.py) 收敛为兼容包装层
- [x] 将主要调用方切换到 `app.modules.tasks.service`
- [x] 将主要调用方切换到 `app.modules.tasks.worker_service`

## 已切换的主要调用点

- [deps.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/api/deps.py)
- [tasks.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/api/endpoints/tasks.py)
- [share_service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/services/share_service.py)
- [files_recorder.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/pipeline/files_recorder.py)
- [context.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/pipeline/context.py)
- [tasks.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/worker/tasks.py)

## 当前状态

现在 `tasks` 已经不只是“模块包装入口”，而是开始拥有自己的真实实现边界。

当前边界关系：

- `app/modules/tasks/service.py` 是异步任务业务主入口
- `app/modules/tasks/worker_service.py` 是 worker 同步侧主入口
- `app/services/task_service.py` 和 `app/services/worker_task_service.py` 仅保留兼容导出

## 下一步建议

- [ ] 继续把 `get_task_service()` 等依赖注入逻辑收口到 `app/modules/tasks/`
- [ ] 开始识别 `TaskService` 中可以抽到 `repository.py` 的数据访问逻辑
- [ ] 评估 `share_service.py` 与 `tasks` 的跨模块调用边界
- [ ] 补一轮 smoke 验证，确认这次真实拆分没有破坏任务链路
