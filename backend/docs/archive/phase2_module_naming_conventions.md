# 第二阶段模块命名约定

本约定用于后续把当前项目从“技术分层主导”逐步演进到“混合模式”。

## 模块命名

未来业务模块统一使用复数或稳定领域名，优先保持和现有接口语义一致：

- `auth`
- `tasks`
- `shares`
- `files`
- `profile`
- `xml`

## 模块内标准文件名

每个业务模块优先使用以下稳定命名：

- `router.py`
- `schemas.py`
- `service.py`
- `repository.py`
- `worker_service.py`

按需补充，但不要随意发散出大量近义名称。

## 推荐目标结构

```text
app/
├─ api/
│  └─ v1/
├─ core/
├─ db/
├─ modules/
│  ├─ auth/
│  │  ├─ router.py
│  │  ├─ schemas.py
│  │  ├─ service.py
│  │  └─ repository.py
│  ├─ tasks/
│  │  ├─ router.py
│  │  ├─ schemas.py
│  │  ├─ service.py
│  │  ├─ repository.py
│  │  └─ worker_service.py
│  ├─ shares/
│  ├─ files/
│  ├─ profile/
│  └─ xml/
├─ pipeline/
├─ processing/
└─ worker/
```

## 约束

- 新增业务代码优先放到目标模块边界，不再继续扩张 `api/endpoints + schemas + services` 的旧分散模式。
- API 层只负责请求解析、鉴权依赖、响应封装。
- 业务规则进入 `service.py`。
- 数据访问进入 `repository.py`。
- Celery 或同步 worker 侧逻辑进入 `worker_service.py`。
- `core / db / pipeline / processing / worker` 继续保留为平台层，不强行塞进业务模块。
