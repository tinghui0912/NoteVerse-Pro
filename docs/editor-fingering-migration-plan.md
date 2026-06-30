# 生成指法迁移到 Editor 任务计划

## 背景

迁移前 `/results` 页面提供“生成指法”按钮，入口位于 `frontend/src/components/results/results-actions.tsx`。点击后调用 `useGenerateScoreFingering()`，进一步调用 `scoresApi.generateFingering(scoreId, { base_revision_id })`，后端 `POST /scores/{score_id}/fingering` 会基于当前 head/base revision 生成带指法的 MusicXML，并立即创建一个新的 `origin=FINGERING` revision。

经过产品职责收敛后，结论是：生成指法会修改 MusicXML 内容，属于编辑行为，应迁移到 `/editor` 页面。`/results` 保留查看、播放、下载、分享、练习、进入编辑等结果消费能力，不再承载会修改乐谱内容的操作。

## 实施状态

已完成：

- `/results` 页面已删除“生成指法”入口和相关文案。
- `/editor` 左侧修正工具已新增“生成指法”入口。
- 点击“生成指法”会先弹出手型大小选择，确认后再生成。
- 前端生成指法时传入当前编辑中的 MusicXML，而不是服务器 revision。
- 后端 `POST /scores/{score_id}/fingering` 已重定义为：输入 `content + hand_size`，输出生成后的 XML content。
- 后端生成指法不再创建 revision、不写 artifact、不更新 head revision、不触发 metadata/render rebuild。
- `RevisionOrigin.FINGERING` 已删除，保存仍统一创建 `RevisionOrigin.EDIT` revision。

已验证：

- `docker compose -f docker-compose.backend-dev.yml run --rm api alembic upgrade head`
- `docker compose -f docker-compose.backend-dev.yml run --rm api alembic current`
- `docker compose -f docker-compose.backend-dev.yml run --rm api pytest tests/test_score_revision_services.py -q`
- `cd frontend && npm run typecheck`
- `cd frontend && npm run lint`
- `cd frontend && npm run test:unit`

## 迁移前链路

### Results

- UI：`frontend/src/components/results/results-actions.tsx`
- Hook：`frontend/src/hooks/queries/use-score-queries.ts`
- API client：`frontend/src/lib/api/scores.ts`
- 文案：`frontend/messages/*/results.json`

现有行为：

1. `/results/{id}` 加载 score detail、artifacts、revision id。
2. 用户点击“生成指法”。
3. 前端调用 `POST /scores/{score_id}/fingering`。
4. 后端创建新的 revision。
5. 前端 invalidate score detail/revisions/artifacts。

### Backend

- Router：`backend/app/modules/scores/router.py`
- Schema：`backend/app/modules/revisions/schemas.py`
- Service：`backend/app/modules/revisions/service.py`
- Fingering engine wrapper：`backend/app/modules/revisions/fingering_service.py`

现有后端语义：

- `RevisionService.generate_fingering()` 会读取 `base_revision_id` 的内容。
- `XMLFingeringService.generate()` 生成带指法的 XML。
- `RevisionService.create()` 立刻创建 `RevisionOrigin.FINGERING` revision。
- 返回 `RevisionRead`，不直接返回生成后的 XML content。

### Editor

- 页面：`frontend/src/app/[locale]/editor/[id]/page.tsx`
- 文档状态：`frontend/src/hooks/editor/use-editor-document.ts`
- 左侧工具：`frontend/src/components/editor/editor-sidebar.tsx`
- 顶部工具：`frontend/src/components/editor/editor-toolbar.tsx`
- 当前 XML 状态：`ScoreDataProvider`
- 历史栈：`HistoryProvider`
- 保存：`useEditorDocument.performSave()` 调用 `useCreateRevision()`。

Editor 当前理念：

- 所有编辑先修改 `currentXml`。
- 修改进入 undo/redo 历史栈。
- 自动保存草稿保存本地 draft。
- 用户点击“保存更改”才创建服务端 revision。

因此生成指法迁移到 Editor 后，最一致的行为应该是：

```text
点击“生成指法”
  -> 生成新的 XML
  -> 写入 currentXml
  -> 重新 parse scoreData
  -> push history
  -> 标记为未保存/进入草稿自动保存
  -> 用户检查并点击“保存更改”
```

## 目标体验

### Results 页面

- 删除“生成指法”按钮。
- 保留“编辑”按钮。
- `results.subtitle` 去掉“生成指法”描述，避免用户误以为结果页可以修改乐谱。
- 删除不再使用的 results fingering 文案，除非其他页面仍引用。

### Editor 页面

- 增加“生成指法”入口。
- 推荐位置：左侧 `修正工具` 区域，和“简化声部”同级。
- 点击后生成指法并更新当前编辑中的 MusicXML。
- 生成结果进入 undo/redo 历史。
- 生成后保持在 `/editor`，不跳转。
- 不自动保存到服务器，用户仍需点击“保存更改”。
- 生成期间按钮显示 loading，并禁用重复点击。
- 若当前 XML 有未保存修改，应基于当前 XML 生成，而不是基于服务器旧 revision 生成。

## 推荐技术方案

### 最终方案：重定义现有 `/scores/{score_id}/fingering`

项目仍处于开发阶段，不需要兼容旧语义，也不保留 fallback。直接把现有接口从“生成指法并创建 revision”改成“基于当前 XML 生成带指法 XML”。

接口保持：

```http
POST /scores/{score_id}/fingering
```

请求体：

```json
{
  "content": "<score-partwise>...</score-partwise>",
  "hand_size": "M"
}
```

响应体：

```json
{
  "success": true,
  "data": {
    "content": "<score-partwise>...</score-partwise>"
  }
}
```

语义：

- `score_id` 保留，用于 EDIT 权限、审计、限流、计费和临时工作目录归属。
- 后端不读取 `base_revision_id`。
- 后端不创建 revision。
- 后端不写 `ScoreArtifact`。
- 后端不更新 `head_revision_id`。
- 后端不触发 metadata/render rebuild。
- 前端基于当前 `currentXml` 调用接口。
- 生成结果写回 Editor 当前草稿，进入 undo/redo 历史。
- 用户点击“保存更改”后才创建 `RevisionOrigin.EDIT` revision。

### 后端改动原则

1. 删除 `FingeringRevisionRequest` 的 revision 语义。
2. 新增或重命名为 `FingeringRequest`：
   - `content: str`
   - `hand_size: Literal["XXS", "XS", "S", "M", "L", "XL", "XXL"] = "M"`
3. 新增响应 schema `FingeringResultRead`：
   - `content: str`
4. `RevisionService.generate_fingering()`：
   - 保留 `ScoreAction.EDIT` 权限检查。
   - 校验传入 MusicXML。
   - 调用 `XMLFingeringService.generate(score_id, content, hand_size)`。
   - 校验生成后的 MusicXML。
   - 返回 `FingeringResultRead(content=...)`。
5. `XMLFingeringService.generate()`：
   - 移除 `hand` / `depth` 参数。
   - 改为 `hand_size`。
   - 调用 `pianoplayer.core.run_annotate(..., hand_size=hand_size)`。
6. 删除 `RevisionOrigin.FINGERING`。
7. 同步清理 contracts、migration、前端类型中的 `FINGERING`。

### 为什么不暴露 hand/depth

`hand` 和 `depth` 更像算法调试参数，不适合作为产品 API 的第一层参数。MVP 阶段只暴露用户能理解并长期稳定的参数：手大小。

参考 `marcomusy/pianoplayer`，手大小参数是：

```text
XXS / XS / S / M / L / XL / XXL
```

Editor MVP 默认使用：

```json
{
  "hand_size": "M"
}
```

后续如果需要个性化，可以把 hand size 放到用户设置或生成指法弹窗中，而不是把算法参数直接暴露给普通用户。

## UI 设计建议

### 左侧工具栏

在 `修正工具` 中新增：

```text
生成指法
```

图标可先继续使用 `Hand`，后续可以替换为音乐符号资产。

按钮状态：

- 默认：可点击。
- `currentXml` 为空：禁用。
- 生成中：loading。
- 成功：toast “指法已生成，请检查并保存更改。”
- 失败：toast “指法生成失败。”

### 是否需要参数

MVP 不展示参数，默认：

```json
{
  "hand_size": "M"
}
```

后续可在用户设置、右侧 Inspector 或弹窗中支持手大小选择：

- XXS
- XS
- S
- M
- L
- XL
- XXL

### 和现有指法编辑的关系

Event Inspector 已经支持逐音修改 `<fingering>`。生成指法应视为批量编辑：

- 批量生成：左侧工具。
- 单音微调：右侧 Inspector。
- 撤销/重做：一次生成作为一个 history entry。

## 具体任务拆分

### 阶段 1：删除 Results 入口

1. 从 `ResultsActions` 删除 `useGenerateScoreFingering` 引用。
2. 删除“生成指法”按钮。
3. 调整 actions grid 布局，避免空位。
4. 修改 `results.subtitle`，去掉 generate fingering。
5. 删除 results 中不再使用的 fingering 文案：
   - `generateFingering`
   - `fingeringSuccess`
   - `fingeringFailed`
   - `fingeringDesc`
   - `fingeringFailedDesc`
6. 更新相关测试或快照。

### 阶段 2：重定义后端 `/fingering` 接口

1. `schemas.py` 将 `FingeringRevisionRequest` 替换为 `FingeringRequest`。
2. `schemas.py` 新增 `FingeringResultRead`。
3. `service.py` 将 `generate_fingering()` 改为不创建 revision，只返回 generated XML。
4. `router.py` 保持 `POST /scores/{score_id}/fingering` 路径，但 response model 改为 `APIResponse[FingeringResultRead]`。
5. `fingering_service.py` 将 `hand/depth` 参数替换为 `hand_size`。
6. 删除 `RevisionOrigin.FINGERING` 及引用。
7. 同步更新 score domain contract 和开发期 migration enum。
8. 添加后端单元测试：
   - 成功返回 XML content。
   - 不创建 revision。
   - 复用 EDIT 权限检查。
   - 非法输入 XML 失败。
   - 非法生成 XML 失败。

### 阶段 3：前端 API 与 hook

1. `frontend/src/lib/api/scores.ts` 修改 `generateFingering` 入参和返回类型。
2. 类型中增加 response 类型，例如 `FingeringResult`。
3. 调整 `useGenerateScoreFingering()`：传 `content + hand_size`，不再 invalidate revisions/artifacts。
4. 错误处理沿用 `ApiError` 和 `errors` 翻译。

### 阶段 4：Editor 文档状态接入

1. 在 `useEditorDocument` 中新增：
   - `generateFingering`
   - `fingeringPending`
2. 成功后更新：
   - `currentXmlRef`
   - `currentXml`
   - `scoreData`
   - `history`
3. history action 使用 `editor.actions.generateFingering`。
4. 不调用 `setBaseRevisionId`。
5. 不跳转。
6. 保持 `save()` 仍然负责最终创建 revision。

### 阶段 5：Editor UI

1. `EditorPageContent` 将 `generateFingering` / `fingeringPending` 传给：
   - `EditorPageHeader`，或
   - `EditorWorkbench` -> `EditorSidebar`
2. 推荐放入 `EditorSidebar` 的 `修正工具`。
3. 给按钮增加 loading/disabled。
4. 增加 editor 文案：
   - `generateFingering`
   - `generateFingeringPending`
   - `fingeringGenerated`
   - `fingeringGeneratedDesc`
   - `fingeringFailed`
   - `actions.generateFingering`

### 阶段 6：测试

前端测试：

1. Results actions 不再包含生成指法按钮。
2. Editor sidebar 包含生成指法按钮。
3. 点击生成指法调用 `/scores/{id}/fingering`，请求体包含当前 `content`。
4. 成功后更新 `currentXml`，并 push history。
5. 生成失败显示错误 toast。
6. 生成期间禁用按钮。

后端测试：

1. `/fingering` 接口返回生成 XML。
2. `/fingering` 接口不创建 revision。
3. `/fingering` 接口复用 EDIT 权限检查。
4. `/fingering` 接口处理非法输入 XML。
5. `/fingering` 接口处理非法生成 XML。

回归测试：

```bash
cd frontend
npm run typecheck
npm run lint
npm run test:unit
```

后端按项目现有测试命令执行。

## 风险与边界

### 未保存修改

必须基于 `currentXml` 生成指法，不能基于服务器 `base_revision_id`。否则用户刚改过音符，再生成指法，会丢失当前编辑上下文。

### 历史栈

生成指法是批量编辑，应作为一个 undo step。用户可以一次撤销整次生成。

### 保存语义

生成指法不等于保存。生成后必须继续显示未保存状态，并由用户点击“保存更改”创建 revision。

### 冲突语义

`/fingering` 不创建 revision，因此不会在生成阶段触发 revision conflict。冲突仍然只在最终保存时处理。

### 已有指法覆盖

MVP 可以沿用后端当前行为。后续需要明确：

- 覆盖所有已有指法；
- 只填补空白指法；
- 由用户选择。

这需要后端 fingering service 支持策略参数。

## 推荐执行顺序

1. 先删除 `/results` 的生成指法入口和文案。
2. 重定义后端 `/fingering` 接口。
3. 新增前端 API/hook。
4. 接入 `useEditorDocument`。
5. 在 Editor 左侧修正工具加入按钮。
6. 补测试。

## 完成标准

- `/results` 页面不再出现“生成指法”。
- `/editor` 页面可以生成指法。
- 生成后谱面立即重新渲染。
- 生成后可以撤销/重做。
- 生成后不会自动跳转，不会自动保存。
- 点击“保存更改”后才创建新的服务端 revision。
- 所有相关测试通过。
