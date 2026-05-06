# 第 2 阶段 Tasks Dependencies 拆分进度

日期：2026-03-25

## 本轮完成

- [x] 新建 [dependencies.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/modules/tasks/dependencies.py)
- [x] 将 `get_task_service()` 迁入 tasks 模块
- [x] 将 `verify_task_ownership()` 迁入 tasks 模块
- [x] 将 `get_task_with_view_access()` 迁入 tasks 模块
- [x] 将 `get_task_with_edit_access()` 迁入 tasks 模块
- [x] 让 [tasks.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/api/endpoints/tasks.py) 直接依赖模块内任务依赖注入
- [x] 让 [files.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/api/endpoints/files.py) 直接依赖模块内任务访问依赖
- [x] 在 [deps.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/api/deps.py) 中保留兼容转发

## 当前边界

- `app/api/deps.py`
  保留认证、数据库、分享等全局依赖

- `app/modules/tasks/dependencies.py`
  负责任务相关 service 注入与任务访问权限依赖

## 下一步建议

- [ ] 继续评估 `shares` 是否也需要独立 `dependencies.py`
- [ ] 做一轮 smoke 验证，尤其关注任务详情、任务列表、文件访问接口
