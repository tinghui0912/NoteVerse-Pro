# 第一阶段实施进度

日期：2026-03-25

## 已完成

- [x] 统一 `User.password_hash` 字段引用，清理 `hashed_password` 业务残留
- [x] 统一 `Share.owner_user_id` 字段引用，清理 `created_by_user_id` 残留
- [x] 清理 `SavedShare.task_id` 历史残留
- [x] 移除对不存在的 `Task.status` 写入
- [x] 统一 `NO_VIEW_ACCESS` 到现有错误码
- [x] 将分享相关请求模型收口到 `schemas/share.py`
- [x] 将认证相关验证码校验请求切换为统一 schema
- [x] 为 worker 专用同步 service 增加过渡期边界说明
- [x] 新增 `app/api/v1/router.py`，由总路由统一聚合接口
- [x] 让 `main.py` 通过总路由注册接口

## 下一步建议

- [ ] 完成一轮 smoke 验证并记录结果
- [ ] 开始把 `db`、`repositories`、`modules/tasks` 的目标骨架搭起来
- [ ] 逐步减少 API 层对 worker 专用同步逻辑的直接依赖
