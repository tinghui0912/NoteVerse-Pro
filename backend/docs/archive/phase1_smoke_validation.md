# 第一阶段 Smoke 验证清单

本清单用于验证第一阶段重构没有破坏关键 happy path。执行时优先覆盖接口契约、鉴权链路和分享链路。

## 验证范围

- 登录
- 注册
- 邮箱验证码发送与校验
- 重置密码
- 文件上传
- 任务提交与任务详情
- 创建分享与保存分享
- XML 加载与保存

## 执行前准备

- 启动 FastAPI 服务
- 确认 Redis 可用
- 准备一个可登录账号
- 准备至少一个可上传测试文件

## 认证链路

- [ ] 调用 `POST /api/v1/auth/email/send-code`，传入注册邮箱，确认返回 `challenge_id`
- [ ] 调用 `POST /api/v1/auth/email/verify-code`，确认返回 `verified_token`
- [ ] 调用 `POST /api/v1/auth/register`，使用 `RegisterRequest` 结构完成注册
- [ ] 调用 `POST /api/v1/auth/login`，确认可以正常拿到 `access_token`
- [ ] 调用 `POST /api/v1/auth/password/verify-code`，确认返回 `reset_token`
- [ ] 调用 `POST /api/v1/auth/password/reset`，确认重置密码成功

## 用户资料

- [ ] 调用 `POST /api/v1/profile/change-password`，确认旧密码校验与新密码写入正常
- [ ] 调用 `GET /api/v1/profile/me`，确认返回结构中不泄露 `password_hash`

## 文件与任务

- [ ] 调用 `POST /api/v1/files/upload`，确认文件上传成功
- [ ] 调用 `POST /api/v1/tasks/submit`，确认任务创建成功
- [ ] 调用 `GET /api/v1/tasks/{task_id}`，确认任务详情接口正常返回
- [ ] 调用任务列表接口，确认任务状态字段来源于 `state`，没有旧 `status` 写入错误

## 分享链路

- [ ] 调用 `POST /api/v1/shares`，使用 `CreateShareRequest` 创建分享
- [ ] 调用 `GET /api/v1/shares`，确认返回结构正常
- [ ] 调用 `POST /api/v1/shares/save`，使用 `SaveShareRequest` 保存分享
- [ ] 调用 `POST /api/v1/shares/saved-shares/batch-delete`，使用 `BatchDeleteSavedSharesRequest` 删除收藏
- [ ] 调用分享访问接口，确认 `owner_user_id` 权限校验正常

## XML 链路

- [ ] 调用 XML 加载接口，确认可正常读取任务关联 XML
- [ ] 调用 XML 保存接口，确认保存逻辑与权限校验正常

## 通过标准

- [ ] 关键接口全部返回预期状态码
- [ ] `/docs` 中接口分组与路由展示正常
- [ ] 没有出现 `hashed_password`、`created_by_user_id`、`NO_VIEW_ACCESS` 这类旧契约报错
- [ ] 分享和任务相关接口不再因不存在字段而写库失败
