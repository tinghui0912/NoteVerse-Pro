# 第 1.5 阶段匿名 Body 清单

日期：2026-03-25

本清单用于记录第 1 阶段收尾时仍保留的匿名 `Body(...)` 输入，作为下一步 schema 收口和模块迁移的准备材料。

## 结论

当前 `auth.py` 和 `shares.py` 已经完成主要请求体 schema 化。

仍然保留匿名 `Body(...)` 的接口集中在：

- `tasks.py`
- `files.py`

这些接口大多属于批量操作或轻量导出参数，适合在进入模块迁移前继续收口为显式 schema。

## 任务接口

文件：[tasks.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/api/endpoints/tasks.py)

- [ ] `POST /tasks/batch-delete`
  当前输入：`task_ids: List[str] = Body(..., embed=True)`
  建议 schema：`BatchDeleteTasksRequest`

- [ ] `POST /tasks/status/batch`
  当前输入：`task_ids: List[str] = Body(..., embed=True)`
  建议 schema：`BatchTaskStatusRequest`

- [ ] `POST /tasks/archive`
  当前输入：`task_ids: List[str] = Body(..., embed=True)`
  当前输入：`include_types: List[str] = Body(["png", "xml"], embed=True)`
  建议 schema：`BatchArchiveRequest`

## 文件接口

文件：[files.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/api/endpoints/files.py)

- [ ] `POST /files/export/excel`
  当前输入：`task_ids: List[str] = Body(..., embed=True)`
  建议 schema：`ExportTasksExcelRequest`

## 建议优先级

- [ ] 高优先级：`tasks.py` 中的 3 个批量接口
- [ ] 中优先级：`files.py` 中的 Excel 导出接口

## 建议放置位置

在当前结构下，可先放入：

- [task.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/schemas/task.py)
- [file.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/schemas/file.py)

在后续模块化结构下，再迁移为：

- `app/modules/tasks/schemas.py`
- `app/modules/files/schemas.py`
