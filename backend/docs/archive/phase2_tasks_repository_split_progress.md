# 第 2 阶段 Tasks Repository 拆分进度

日期：2026-03-25

## 本轮完成

- [x] 在 [repository.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/modules/tasks/repository.py) 中建立 `TaskRepository`
- [x] 将任务列表查询逻辑从 [service.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/modules/tasks/service.py) 抽到 repository
- [x] 将缩略图类型查询逻辑抽到 repository
- [x] 将按 UUID 查询任务逻辑抽到 repository
- [x] 将批量状态查询逻辑抽到 repository
- [x] 将批量删除前置查询与关联清理逻辑抽到 repository
- [x] 保留文件系统清理逻辑在 service 层，避免 repository 越界处理磁盘副作用

## 当前边界

- `service.py`
  负责权限、业务规则、异常语义、文件系统清理

- `repository.py`
  负责数据库查询、批量关联删除、列表统计

## 下一步建议

- [ ] 继续识别 `TaskService` 中可下沉到 repository 的更新逻辑
- [ ] 评估是否为 `tasks` 增加 `dependencies.py`
- [ ] 补一次任务链路 smoke 验证，确认拆分后行为保持一致
