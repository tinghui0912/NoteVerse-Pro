# 乐谱跟随系统优化计划

## 目的

本文档将当前乐谱跟随系统的复盘结论整理成可执行的工程计划。重点是让实时练习系统变得更稳定、可解释、可测试，并逐步达到付费在线钢琴学习产品所需要的工程质量。

本计划的目标不是替换当前的 `Chroma + OLTW` 基础方案。主要工作是梳理音频活动检测、置信度、延迟、视觉更新和回归评测之间的职责边界。

## 当前基线

当前练习跟随系统的大方向是正确的：

- 浏览器通过 WebSocket 将麦克风 PCM 音频流发送到后端
- 后端使用 Matchmaker 的 Chroma 特征和 OLTW 进行实时对齐
- 跟随开始后，音频活动检测不再硬停止 OLTW worker
- activity state 用于限制 confidence，并生成 `match_state`
- 前端会保持低置信度更新，并防止视觉高亮大跳跃
- Spectral Flux 用于 onset/activity 辅助，而不是作为主对齐特征

当前剩余的主要问题不是主算法太简单，而是多个职责仍然耦合在同一条运行路径里。这会让稳定性调优变得难以解释和测试。

## 优先级路线图

### P0. 保留当前核心路线

状态：保留

除非后续评测集证明需要改变，否则应保留以下决策：

- `Chroma + OLTW` 继续作为实时对齐主路径。
- Spectral Flux 保留用于 onset/activity detection，不进入 OLTW 主对齐。
- Activity detection 应影响 confidence 和状态，而不是硬停止 OLTW。
- Start detection 应比 runtime activity detection 更严格。
- 前端视觉保护逻辑应继续保留，用于保护用户体验。
- `PRACTICE_AUDIO_DIAGNOSTICS` 在稳定性优化阶段继续保持开启。

暂时不要优先做：

- 用 LSE 替换 Chroma
- 引入 CREPE、YIN、pYIN 或 Transformer follower
- 在没有可靠评测集之前重建一个新的 ML follower

### P1. 拆分后端音频运行时职责

状态：第一轮已完成

问题：

`BrowserAudioStreamAdapter` 目前同时负责音频特征提取、噪声校准、起音检测、运行态 activity 判断、计数器维护、stream state 更新和 diagnostics 日志。这会导致调优或测试某一个关注点时，容易影响到其他关注点。

目标结构：

- `AudioFeatureExtractor`
  - 计算 RMS、Peak、Spectral Flatness、Peak Prominence、Spectral Flux 和 onset 标志
- `AdaptiveNoiseCalibrator`
  - 负责 RMS/Peak/Flux 的噪声底和校准后的门限
- `PracticeActivityStateMachine`
  - 负责 `calibrating`、`armed`、`following`、`holding_decay` 和 `lost`
- `ActivityConfidenceEstimator`
  - 将 activity state 转换成 audio confidence ceiling
- `MatchmakerLiveEngine`
  - 负责 Matchmaker/OLTW 集成和输出融合

主要文件：

- `backend/app/processing/engines/matchmaker_live.py`
- 可在 `backend/app/processing/engines/` 或 `backend/app/processing/realtime/` 下新增文件

验收标准：

- 特征提取可以在不启动 Matchmaker 的情况下进行单元测试
- activity state 可以用合成 feature frame 进行单元测试
- 现有 practice websocket 回归测试继续通过
- diagnostics 仍然暴露同样有用的字段

实施记录：

- 已新增 `practice_audio_activity.py`，拆出 `AudioFeatureExtractor`、`AdaptiveNoiseCalibrator`、`PracticeActivityStateMachine` 和 `ActivityConfidenceEstimator`
- `BrowserAudioStreamAdapter` 已改为编排这些组件，不再直接持有全部音频分析和 activity 状态
- 本轮保持既有行为不变，后续 P2/P3 再调整 confidence 和 runtime activity 策略

### P2. 正式化 Confidence Fusion

状态：第一轮已完成

问题：

当前 confidence 主要是 raw alignment confidence，再被 audio activity 做 ceiling 限制。前端 continuity guard 又额外加了一层保护，但这些逻辑还没有表达成一个明确的置信度模型。

目标模型：

- `alignment_confidence`
  - 来自 OLTW cost/progress/path behavior，或者当前可用的最佳替代指标
- `audio_confidence`
  - 来自 activity state、最近的音乐输入和音频特征质量
- `continuity_confidence`
  - 来自 beat delta、jump size、tempo plausibility 和 recovery state
- `visual_confidence`
  - 前端最终用于决定是否更新高亮的信号

主要文件：

- `backend/app/processing/engines/matchmaker_live.py`
- `frontend/src/lib/practice/follow-controller.ts`
- `frontend/src/types/api.ts`

验收标准：

- 后端 alignment update 暴露足够字段，可以解释为什么 confidence 低
- 前端不再需要从单一的 `confidence` 数字推断所有视觉可信度
- 大跨度 beat jump 在到达视觉层之前就被惩罚
- 低置信度保持行为是确定性的，并且可以测试

实施记录：

- 后端 alignment update 已增加 `alignment_confidence`、`audio_confidence`、`continuity_confidence` 和 `visual_confidence`
- `confidence` 继续作为最终置信度保留，用于持久化和报告逻辑
- 前端 `PracticeFollowController` 已优先使用 `visual_confidence` 进行高亮更新判断
- 当前 `alignment_confidence` 和 `continuity_confidence` 仍基于 beat 连续性代理指标，后续可继续接入 OLTW cost/path stability

### P3. 将 Runtime Activity 改成更 Session-Based

状态：第一轮已完成

问题：

当前 runtime activity 仍然比较依赖逐帧 tonal 和 energy 检查。这已经比最初的硬门控好，但钢琴演奏中存在弱音、踏板延音和乐句停顿，这些情况不应该立刻让系统认为演奏会话已经不活跃。

目标行为：

- 对第一个有效 performance onset 使用严格 start gate
- 跟随开始后使用更宽松的 runtime gate
- runtime activity 基于 session window 内最近出现过的有效音乐活动
- 短暂间隙进入 `holding_decay`
- 较长间隙进入 `lost`
- 跟随开始后 OLTW 持续运行

建议的初始常量：

- recent music window：1.0-1.5 秒
- lost threshold：和短暂 hold decay 分开设置
- onset hold 仍然有价值，但不应成为唯一的 sustain 机制

主要文件：

- `backend/app/processing/engines/matchmaker_live.py`

验收标准：

- 钢琴长音不会导致 active/inactive 快速抖动
- 短暂停顿时视觉光标保持稳定
- 噪声突发不会重新启动或跳转 follower
- diagnostics 能清楚解释为什么当前状态是 `following`、`holding_decay` 或 `lost`

实施记录：

- `PracticeActivityStateMachine` 已记录最近一次可信音乐活动帧
- Runtime activity 已从纯逐帧判断改为 session-window 行为
- onset/tonal activity 会刷新 session window，窗口内的弱衰减信号继续维持 `following`
- 持续超过窗口且没有有效活动后，才进入 `holding_decay` / `lost`

### P4. 明确前端练习状态和视觉语义

状态：第一轮已完成

问题：

用户可见文案、录音计时、后端 readiness 和视觉提示容易混在一起。UI 应清楚表达系统当前是在准备、等待第一个音符、正在跟随、暂停，还是已经结束。

目标行为：

- “准备中”表示系统正在建立采集链路并进行校准
- “等待第一个音符”表示后端已经 armed，可以等待第一个有效 onset
- 录音开始后立即显示录音时长
- 高亮音符表示“下一个应弹提示”，不总是 raw matched performance position
- 暂停不应清除当前提示高亮

主要文件：

- `frontend/src/app/[locale]/practice/[id]/page.tsx`
- `frontend/src/lib/practice/follow-controller.ts`
- `frontend/src/components/practice/practice-score-viewer.tsx`
- `frontend/messages/*/practice.json`

验收标准：

- 用户可以判断录音是否已经开始
- 用户可以判断什么时候可以弹奏第一个音符
- 暂停和低置信度保持期间，高亮仍然稳定
- 视觉提示不会在一次更新中跳过多个乐谱事件

实施记录：

- “准备中”文案已明确提示用户先不要弹奏
- “等待第一个音符”文案已明确表示系统准备好了，可以开始弹奏第一个音符
- 录音时长在录音准备/监听/练习阶段保持可见
- 前端视觉高亮已通过 `visual_confidence` 和顺序推进策略保护，不直接服从 raw beat 跳转

### P5. 加入延迟补偿

状态：第一轮已完成

问题：

系统当前会发送 timestamp，但还没有把采集、网络、处理和渲染延迟作为一层正式模型。付费练习产品需要高亮“体感上准时”，而不仅仅是技术上对齐。

目标模型：

- capture timestamp
- backend receive timestamp
- processing timestamp
- frontend receive/render timestamp
- estimated end-to-end latency
- 可选：根据 tempo 和 latency 预测 beat position

主要文件：

- `frontend/src/app/[locale]/practice/[id]/page.tsx`
- `backend/app/modules/practice/router.py`
- `backend/app/processing/realtime/message_codec.py`
- `backend/app/processing/engines/matchmaker_live.py`

验收标准：

- 每次 session 的 latency 可以被记录和检查
- 视觉高亮可以基于测得的补偿值进行偏移
- 如有需要，可以通过明确的 feature flag 关闭补偿

### P6. 建立自动化音频回放评测集

状态：计划中

问题：

当前阈值和置信度调优主要依赖人工日志。这不足以支撑企业级稳定性。

目标评测集：

- 正常干净演奏
- 弱音演奏
- 踏板延音
- 乐句停顿
- 错音
- 漏音
- 重复音
- 跳转/恢复场景
- 背景噪声
- 咳嗽/翻谱/椅子噪声
- 笔记本或手机外放录音

评测指标：

- time to first alignment
- beat error over time
- skipped visual events
- false starts
- lost/recovered counts
- confidence stability
- frontend highlight jump count

主要文件：

- 在 `backend/tests/fixtures/practice_audio/` 下新增 fixtures
- 在 `backend/tests/` 下新增 tests
- 可选：为前端 controller 增加视觉更新策略测试

验收标准：

- 回归测试可以回放已知音频或合成 feature trace
- 调参必须改善或至少保持指标基线
- 至少有一个测试覆盖弱音/延音钢琴输入
- 至少有一个测试覆盖非音乐瞬态噪声

实施记录：

- 已新增 `backend/tests/test_practice_audio_replay_evaluation.py`
- 第一版评测使用合成音频帧，不引入真实音频资产
- 已覆盖弱音/延音保持、非音乐瞬态噪声不误启动、静音后从 session window 衰减到 `lost`
- 后续可在 `backend/tests/fixtures/practice_audio/` 下补充真实音频 fixtures

### P7. 简化或删除已被替代的旧逻辑

状态：计划中，在 P1-P6 之后执行

在新的边界和测试建立之前，不要激进删除。

可删除或合并的候选项：

- `active_streak`、`start_streak` 和 `no_input_streak` 之间重复的语义
- 分散在特征提取代码里的直接状态修改
- 已不再使用的旧 alignment-engine 配置路径
- 非 Chroma / 非 Arzt Matchmaker 模式的兼容分支
- 只为支持已删除后端状态而存在的前端状态分支

应保留：

- RMS 和 Peak 测量
- Spectral Flatness
- Peak Prominence
- Spectral Flux
- Chroma alignment
- 稳定性优化阶段的 diagnostics

应收窄职责：

- Peak 应主要支持 start/onset 检查，不应主导 runtime activity。
- Runtime activity 应更加 session-window-based，减少 frame-classifier-based 的倾向。
- 前端应将 raw beat 作为视觉策略的输入，而不是把它当成直接跳转高亮的命令。

验收标准：

- 删除代码前，必须先有测试保护行为
- 被删除的 settings 同步从 config、validation、docs 和 examples 中移除
- cleanup 后 diagnostics 仍然容易理解

## 建议执行顺序

1. P1 在保持行为不变的前提下拆分后端职责。
2. P2 增加明确的 confidence 字段和后端 continuity penalty。
3. P3 将 runtime activity 推向 session-window 行为。
4. P4 收紧前端状态文案和视觉语义。
5. P6 在大规模阈值调优之前建立第一版回放评测集。
6. P5 增加延迟测量和延迟补偿。
7. P7 在新测试建立后删除或合并旧逻辑。

P6 在执行顺序中排在 P4 之后，只是因为它更依赖稳定的事件契约。一旦第一版评测 harness 建立起来，它就应该成为后续所有改动的一部分。

## 下一轮稳定性优化的非目标

- 替换 Matchmaker
- 将主对齐特征从 Chroma 切换到其他特征
- 将 LSE 做成面向产品用户的选项
- 为复音钢琴跟随引入 ML pitch tracker
- 构建 Transformer follower
- 在没有可回放测试用例的情况下，仅凭生产现象调参

## 完成定义

当满足以下条件时，本轮稳定性优化可以认为完成：

- 后端音频特征提取、activity state 和 confidence fusion 可以作为独立单元测试
- 前端高亮由有文档说明的 visual policy 驱动
- latency 可测量，并可选择进行补偿
- 回放测试覆盖正常、弱音、延音、噪声和恢复场景
- 过时配置和兼容路径已移除
- 不读源码也能从日志解释系统为什么处于 listening、following、holding、lost 或 recovering 状态
