# Phase 3 Shared 层评估与启动

## 结论

`shared` 层已经适合启动，但应采用**低风险、分步收口**策略。

当前最适合先落地的是：

- `shared/responses.py`
- `shared/constants.py`

当前还**不适合彻底强拆**的是：

- `FileKind`
- 其它与 ORM 或模型层强耦合的枚举

## 本轮已完成

- 新增 [__init__.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/shared/__init__.py)
- 新增 [responses.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/shared/responses.py)
- 新增 [constants.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/shared/constants.py)
- 将 [response.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/schemas/response.py) 降级为兼容层
- 开始把主要调用点切到 `app.shared.responses`，包括：
  - `modules/shares/router.py`
  - `modules/xml/router.py`
  - `modules/profile/router.py`
  - `api/endpoints/files.py`
  - `api/endpoints/auth.py`
  - `api/endpoints/tasks.py`

## 为什么 `responses` 适合先迁移

原因很明确：

- 它是纯共享能力
- 不依赖某个业务模块
- 不依赖 ORM 模型
- 改成兼容转发后迁移风险很低

所以它非常适合作为 `shared` 层的第一批内容。

## 为什么 `constants` 只能先做半步

虽然 `ErrorCode` 和 `SuccessCode` 本身适合共享，但当前 [__init__.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/constants/__init__.py) 还同时导出了 `FileKind`。

而 `FileKind` 当前来源于：

- [file.py](/c:/Users/12631/Downloads/NoteVerse-Pro/backend/app/models/file.py)

这意味着当前 `constants` 包还没有彻底摆脱和模型层的耦合。

所以这一阶段更合理的策略是：

- 先新增 `app/shared/constants.py`
- 仅承接 `ErrorCode` / `SuccessCode`
- 暂不强拆 `FileKind`
- 继续保留 `app.constants` 作为兼容和过渡入口

## 当前状态判断

### 已进入 `shared`

- 统一响应模型和响应 helper
- 纯业务码导出入口

### 暂不进入 `shared`

- `FileKind`
- 与 SQLModel / ORM 实体强耦合的枚举
- 仍在平台层和业务层交叉使用、边界还不稳定的内容

## 下一步建议

### 建议 1

继续逐步把剩余 `from app.schemas.response` 调用切到 `from app.shared.responses`。

### 建议 2

评估是否要让以下调用开始切到 `app.shared.constants`：

- 纯使用 `ErrorCode`
- 纯使用 `SuccessCode`

但前提是不要把 `FileKind` 一起迁进去。

### 建议 3

不要急着创建 `shared/enums.py`，除非先把枚举做过一轮“与模型层解耦”的分类整理。
