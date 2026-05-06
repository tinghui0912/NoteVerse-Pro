# 第 1.5 阶段进度补充

日期：2026-03-25

## 本轮已完成

- [x] 统一 [deps.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/api/deps.py) 中 `get_current_active_superuser()` 的角色比较，改为 `UserRole.admin`
- [x] 盘点 [tasks.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/api/endpoints/tasks.py) 中剩余匿名 `Body(...)` 输入
- [x] 盘点 [files.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/api/endpoints/files.py) 中剩余匿名 `Body(...)` 输入
- [x] 输出匿名请求体迁移清单：[phase15_body_schema_inventory.md](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/docs/archive/phase15_body_schema_inventory.md)

## 结果

剩余匿名 `Body(...)` 主要集中在批量任务接口和 Excel 导出接口，适合在下一轮继续收口到：

- [task.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/schemas/task.py)
- [file.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/schemas/file.py)

