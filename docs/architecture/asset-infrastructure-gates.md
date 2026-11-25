# Asset Infrastructure Architecture Gates

Task 0.2，调查基准 `480bff0180bd1d74f60679f23a0e0df362701b08`。
Task 0/0.1 的调查与既有 Accepted Contracts 仍为依据；下面的新方案没有自动取得批准。
本文件与 [RFC](asset-infrastructure-rfc.md) 一起供负责人审查；**不授权 Task 1**。
状态中的 APPROVED 只引用已有 accepted contract，不能表示作者批准了新设计。
新设计结论均为 UNRESOLVED，直到负责人明确接受；BLOCKED 表示指定的证据或环境仍缺失。

## A. 当前锁的真实含义

源码调查覆盖 `app/modules`、`app/composition`、`app/worker` 内全部 `with_for_update`、
advisory lock、accounting、Hold、adoption、retirement 和 commit 调用；再沿调用方展开。
这里的边是**同一 PostgreSQL 事务内第一次取得仍持有的锁**，不是所有函数名的机械排序。
同一事务重入已持有的 Account/Entitlement 不制造新的反向等待边。

| 符号 | Authority / SQL | 真实获取入口及差异 |
| --- | --- | --- |
| P | Business parent；主要 FOR UPDATE，Take 可选 linked Score FOR KEY SHARE | ScoreAccessPolicy、RevisionWriter、lock_presentation_score；Import 先 Dispatch 再 Job；Bundle 先父授权，再 Binding、Bundle。不同父图不能折叠为一个全局 Parent mutex |
| Lk / Ln / Lu | User lifecycle：FOR KEY SHARE / FOR NO KEY UPDATE / FOR UPDATE | resource_admission.lock_active_resource_user = Lk；AccountDeletionRepository.lock_user 默认 Ln，erasure=True 为 Lu。Lk 与 Ln 兼容，Lu 等待 Lk。不是同一种排他锁 |
| E | UserStorageEntitlement FOR UPDATE | QuotaEntitlements.resolve(lock=True) → repository.entitlement；共享 PlanPolicy 只是 SELECT，不锁住整个套餐 |
| A | StorageUsageAccount FOR UPDATE | UsageService.committed_bytes(lock=True) / record_allocation / record_release → repository.account。每个 User 的 committed occupancy/记账串行化 |
| H | StorageQuotaHold FOR UPDATE + guarded UPDATE | QuotaService._lock_hold_row 先 E→A 再 H；expiry E SKIP LOCKED→A→H SKIP LOCKED。Hold 不是 Counter，也不保存 Usage reserved projection |
| C | StorageUsageCounter FOR UPDATE；不存在时 INSERT | record_allocation/release、reconcile。所有当前 Counter mutation 在持有同一 User A 后进行；A 不等于 C |
| B | business command / Reservation / Take FOR UPDATE | UploadRepository.creation_request、Take repository reservation、Take row mutation。新建行还涉及唯一键/FK等待 |
| S | UploadSession | 当前不存在。下文仅设计；不能将不存在的锁算入当前安全证明 |
| I | ObjectWriteIntent FOR UPDATE | prepare_write、inspect_write、adopt_written_object、cleanup。唯一 key 插入使用 SAVEPOINT 恢复竞争 |
| O | StoredObject FOR UPDATE；新对象 INSERT | _matching_object、retain_for_reference、retirement._object；Take Writer 是新 candidate row INSERT，而非对已有共享 row 的 FOR UPDATE |
| R | StoredObjectRetirement FOR UPDATE；新操作 INSERT | retain_for_reference/retire_if_unreferenced。Objects 统一顺序 I→O→R；Retirement 不反向取 I |
| X | Outbox 行锁或 INSERT；Accounting Event INSERT | Render/Playback claim/require 有真实 FOR UPDATE；UsageEvent 没有独立“Event FOR UPDATE”。INSERT 仍涉及索引和 User FK 的 KEY SHARE，不能漏掉隐式等待 |

另有邮箱 transaction advisory lock：关闭使用 Ln→email；最终擦除使用 Lu→try-email，失败返回 busy。
Scheduler session advisory lock 属执行基础设施，与本表 domain transaction 不混为一层。

### A1. 实际调用链与提交分段

每行 T1/T2 是独立事务。U 表示 FOR UPDATE；k/n 同上。箭头省略了无锁 MVCC SELECT、纯解析和重入锁。
“逆序”列说明是否实际存在获取同一批 authority 的相反路径，不把未运行的未来设计声称为安全。

| 调用链 / 获取函数 | 同一事务的真实锁序 | IO / COMMIT 边界 | 逆序与结论 |
| --- | --- | --- | --- |
| Upload create：UploadService.create_upload → quota.lock_user / creation_request / create_hold | T1 Lk→E→A→B→H（新 command/H 为 INSERT） | T1提交使command/H durable；尚未put | 未在B后首次取E/A；后续quota重入不是反向边 |
| Upload physical write：write_object → prepare_write / perform_write | T2 I→O检查；提交PREPARED。T3 I→O检查→put→WRITTEN提交 | 精确I锁覆盖put；不持业务/User/容量锁等待IO | cleanup同I→O，不从O反取I |
| Upload semantic completion | T4 Lk→E→A→B→H→I→O→R→Upload INSERT→C→Event INSERT | adoption/consume/allocation/result一个COMMIT | Counter在Objects后，但同User A已持有；全局共享blob由O/R串行化 |
| Upload replay / failure recovery | replay Lk→E→A→B，读取已完成结果；失败先rollback，fresh Session读B后E→A→H释放 | replay提交；恢复不以丢失COMMIT ACK当失败；Intent由自身cleanup负责 | recovery的B发现是普通SELECT，不是B锁→E；不重复Allocation |
| Avatar replace / clear：AvatarService | 预写同I协议；replace最终 Lu→I→O/R新→User reference替换→O旧→R旧；clear Lu→清FK→O旧→R旧 | JPEG处理在业务锁外；预写提交；replace自行phase commit；clear由caller提交 | 无E/A/H/C；Avatar key独有、User Lu串行化同头像，不能据此授权任意O→A |
| Take reserve：authorize_bundle_for_save / reserve_upload | 新准入 P(Score、Revision、access fact、Binding、Bundle)→Lk→E→A→B/H INSERT；已有请求replay Lk→E→A→B→H按需要 | Manifest/Reservation/H同提交；签URL是本地签名，不是Provider上传IO；Bundle预写有自己的phase提交并重新授权 | 当前业务Reservation仍独立；不同阶段不能用一张长事务图连起来 |
| Take finalize lease：finalize_take | T1 Lk→E→A→B；lease/状态提交；已完成replay在B下检查H | 完整staging读取、candidate copy、candidate完整hash在T1提交后 | 不持容量锁执行大录音IO |
| Take final semantic admit：Writer.adopt / effects | T2 optional Score k→Lk→E→A→B→新O INSERT→H→C→Event INSERT | 当前Writer直接创建O；Take/Reservation/H/Usage一个COMMIT | O早于H，但E/A早已持有，且该O是唯一candidate；不能把它推广为共享O→首次H的规则 |
| Take cancel | Lk→E→A→B→H | state/release同提交，不直接删除暂存物 | expiry/recovery同容量前缀，无B持有后首次等A的caller |
| Take reservation expire / temporary cleanup | 短candidate读；每项T1 非active Lk→E→A→B→H；提交恢复。无DB锁临时delete；T2同前缀重新核对并ack | 每次临时IO前提交；ack重新hydrate，过期并不证明迟到copy停止 | domain expiry不同于Quota expiry，后者只改H |
| Quota expiry | E(U,skip)→A(U)→H(U,skip) | worker-owned batch提交；无Provider IO、不改Reservation | 没有H→首次E/A；失去entitlement仅在整个lineage已擦除时跳过 |
| Take delete / account Take cleanup | delete A→Take B→C/Event→O→R；account cleanup E→A→Reservation B→H，或已有A下调用delete | 语义release与retirement admission同caller事务；物理清除独立 | 相对O/C与finalize不同，但同一User A包围两者。Take临时clean ACK之前不删除Reservation/Manifest |
| Revision create / restore：RevisionService._append / RevisionWriter.write | T1 sorted Lk→E→A→H并提交；预写I协议；Tfinal Score U→sorted Lk→E→A→H→I→O/R→semantic/outbox INSERT→C/Event | SOURCE预留、物理写、semantic admit是三段；head/role重新验证；no-op释放H | 无I锁跨入新的Score/容量事务；Outbox INSERT可能在C之前，不能都写成C之后的锁 |
| Render replacement | claim P→Lk→render X并提交；engine/write I协议；admit P→Lk→X→A→所有新I/O/R→C/Event→旧O/R | engine和prewrite不跨admit父锁；旧asset删除有隐式row锁；最终worker提交 | 新Intent均在旧对象retirement之前；同Score父锁串行化多页；render key不跨Score共享 |
| Playback replacement | worker claim P→Lk→playback X提交；生成/prewrite；admit P→Lk→X（worker入口）→A→I/O/R→C/Event→旧O/R | 同步生成入口无X attempt；两条路径均先A再Objects/accounting | 不能把HTTP生成与worker claim混为同一事务；source fingerprint和lease仍各自验证 |
| Import Artifact replacement：require_current_attempt / replace_artifacts | Dispatch U→Job U→A→所有新I/O/R→release/allocate C/Event→旧O/R | pipeline先独立prewrite；artifact replacement自行提交 | 旧artifact FK删除不等于先锁旧O；修复过的I-before-old-retirement顺序仍保留 |
| Review update / confirmation | update Dispatch→Job→A→I/O/R→C/Event→旧O/R；confirm T1 Dispatch→Job→Lk→E→A→H提交，prewrite，Tfinal Dispatch→Job→新Score→RevisionWriter上述序列→Upload sorted→C→释放旧Artifact O/R | confirmation有明确phase提交；新Score/Source/InputAsset/Job/通知同semantic提交 | Upload/InputAsset首次promotion净零但仍A保护；后续额外input有H。account cleanup不在持有Lu时取Job/Score |
| Practice Bundle create / retention | authorize P和access locks→Binding→Bundle；CREATING提交；逐个I预写；重新授权→Binding→Bundle→两个I/O/R→READY/Binding提交；retention Bundle U→查Binding→解除FK→sorted O/R | Bundle read-back可能在Binding/Bundle锁内；窄I锁覆盖物理put；不涉及A/C/H | 同bundle共享其父Bundle锁；无“Bundle adoption再取Usage”路径；未声称所有Provider读均无锁 |
| Account Closure / erasure | closure Ln→email→Invite/Mail/credential mutation→Operation INSERT，原始HTTP事务提交；erase先AccountOperation U，按phase取ScoreDeletionOperation→Score、Import Dispatch→Job、E/A→Take、A→Upload；FINALIZE Lu→try-email→try-E/A→H/有界历史→Avatar O/R→User DELETE | 每个erase unit独立提交；busy必须释放当前事务，不同步等正式对象Retirement | FINALIZE不取Score/Job；try容量是防止A→Event User FK与Lu→A倒序等待的必要边界 |
| Object Retirement / retain | semantic release先持相应A/P，解除FK和release后sorted O→R；retain I可选→O→R；worker claim R短事务提交，后续O→R重验→fence提交→重新O→R→FK flush→delete→COMMIT | worker物理delete在已提交fence与当前O/R锁保护下；快照不随O删除消失 | claim R事务不再等待O；不存在同事务R→O。fenced对象不能cancel/reuse |

函数来源：[Usage service/repository](../../backend/app/modules/storage_usage/service.py)、
[Quota service](../../backend/app/modules/storage_quota/service.py)、[Expiry](../../backend/app/modules/storage_quota/expiry.py)、
[Writes](../../backend/app/modules/storage_objects/writes.py)、[Retirement](../../backend/app/modules/storage_objects/retirement.py)、
[Take effects](../../backend/app/modules/performance_takes/upload_reservation/effects.py)、
[Account executor](../../backend/app/composition/account_deletion.py)。
业务具体路径和Objects适用范围还见RFC的源码矩阵；本表不修改accepted runtime contract。

### A2. Account / Counter / Hold 结论

**APPROVED（既有规则）**：A是用户级committed accounting串行化，C是类别计数，H是容量授权。
Counter只有 `record_allocation`、`record_release`、`reconcile_user` 三个运行时修改入口：
前两者先_require_account(lock=True)，reconcile先_account(lock=True)再读inventory/写counter。
没有Provider、Quota Hold或单独Counter成为第二套Usage authority。

`A→Objects→C` 的目的是在adoption前冻结该用户记账/容量事实，而不提前修改最终语义Usage。
存在 `A→C→Objects` 的release/reclassification路径；这**不是**统一全局总序，
但同User竞争者先被A串行化，因此不能一方持C等Objects、另一方持Objects再等同User C。
跨User共享Upload只有一个canonical物理对象；其adoption在各自A之后，O/R持有者不请求另一User的A/C。
Bundle、Avatar、Intent cleanup和Retirement不请求Usage A/C；Take unique candidate不与另一业务target共享。
多对象Render/Import/Bundle还由各自Score/Job/Bundle父锁保护，key builder限制真实重叠集合。
这里的证明依赖这些**当前调用和身份域事实**，不是允许未来新增任意O→A的通行证。

**UNRESOLVED（目标统一方案待批准）**：保留A作为所有accounting路径的先行串行化点，
参与Usage的业务必须先取得A再采用/保留任何Objects，counter只在最终语义事务内修改；
无需把C一律移到Objects之前，也无需新增“UsageLock”抽象。
非记账对象路径不得在持O/R时再进入Usage；多User新增命令必须预先按ID取所有A。
未来Session worker只取自身S/Operation，不取业务P/E/A；业务consume从P/L/E/A/B/H进入S再进入Objects。
Objects的copy/adoption不能获取Quota、Usage或User；这些依赖不可通过统一adopter隐藏进去。

**BLOCKED（完整实施资格）**：新Session/Copy实现还不存在，无法实际证明其运行时锁图。
本批PG测试证明当前primitive与prototype约束，不等于整个新架构已获得无死锁证明。

### A3. 本批PostgreSQL证据

[新增PG测试](../../backend/tests/test_asset_gate_postgres.py) 使用独立Session和实际
`pg_blocking_pids`/Event屏障，无sleep或扩大timeout：

- 同A下object-first adoption与counter-first accounting竞争：B在A处等待，之后可采用同一对象。
- 跨 User 使用真实 UploadService.create_upload、真实 blob_object_key（同图片 SHA/extension）和各自独立连接：
  两者先完成真实 prewrite phase，再分别持自己的 E/A/H 进入 semantic adoption。强制 user 1 持有 I/O/R、
  user 2 在共享 Intent I 等待；pg_blocking_pids 确认 owner PID 是 blocker，而 owner 没有反向等待。
  owner 继续 C/Allocation 并提交，第二个完成。结果是唯一 O、两份 Upload、每 User 一次 UsageEvent/Allocation、
  两个 CONSUMED H，Retirement CANCELLED/无 fence。删除 user 1 的 Upload 后，user 2 用量与共享 O 均保留。
  这证明当前真实 canonical 共享路径中的 I/O/R 串行化；不是声称没有 I 锁的任意双对象路径都安全。
- H消费持E/A时，Account `_finalize` 在Lu下返回busy而不倒序阻塞；rollback保持H。
- closure Ln可以在预准入Lk存在时提交；新准入被拒绝，最终Lu等旧writer释放。
- Take完整candidate验证后暂停，另一事务按虚拟deadline执行reservation expiry；迟到finalize不能生成Take或Usage。
  该测试的存储fixture只承载字节；数据库并发是真PostgreSQL，**不作为Provider资格证据**。

另运行既有Intent/Retirement、Take reservation、Account deletion和Quota PG suites，
保留retirement-vs-retain/adoption、fence未知COMMIT、expiry和admission等真实row-lock回归。
执行数量/结果以本次交付报告为准；不因测试文件存在便宣称通过。

## B. 新资源的Account Erasure闭合设计

以下都是 **UNRESOLVED 新提案**。现有五阶段实现没有 Session/CopyOperation；本批不修改它。

### 当前事实与需改变的职责

[cleanup_account_take / account_take_cleanup_pending](../../backend/app/modules/performance_takes/account_cleanup.py)
目前把 RESERVED/FINALIZING、`staging_cleanup_completed_at` 以及 `orphan_final_object_keys` 合并为 pending。
现有 Take 自己的定期 cleanup 会产生 ACK，现有 executor 的 TAKES 可以等待它。
但未来物理执行移交 Objects/TRANSFERS 后，**不能沿用这个混合条件作为 TAKES 的完成条件**，
否则 TAKES 等后面的 TRANSFERS，TRANSFERS 又无法被执行。旧条件不能仅改名后保留。
[Upload cleanup](../../backend/app/modules/uploads/account_cleanup.py) 已将语义删除和历史删除分开；
[executor FINALIZE](../../backend/app/composition/account_deletion.py) 当前执行有界 Request/Manifest 历史擦除。
目标保留这个分工，把物理传输收尾明确放在中间阶段。

```text
SCORES -> IMPORTS -> TAKES -> UPLOADS -> TRANSFERS -> FINALIZE
                    |                    |
                    +-- 业务 release ----+--> Objects phase workers -> 唯一物理 ACK
```

| Phase | Resource / 责任 | Completion Condition / 后续责任 |
| --- | --- | --- |
| Closure 原始事务 | tombstone、认证凭证失效、durable erasure operation | 原子提交立即退出；不声称已撤销 Provider 能力 |
| SCORES / IMPORTS | 既有 domain 正式删除、Usage release、Retirement admission | 既有语义资源为空；不等待正式对象物理删除 |
| TAKES | 取消 RESERVED/FINALIZING，释放尚未消费 H；删除最终 Take 并精确释放 UPLOAD；明确 input/candidate 的业务 release，登记 Objects cleanup | **Semantic Cleanup Pending 为零**：无 live Take、无可继续完成的 Reservation、所需 release 已提交。保留 Reservation/Manifest、binding、copy lineage；不等待物理 ACK，不删除历史 |
| UPLOADS | 删除正式 Upload 语义资源并 release Usage | 无正式 Upload；所有 UploadCreationRequest 历史继续保留，尤其仍有 binding 的请求；不等待 Session ACK |
| TRANSFERS | 取消未消费 Session、处理 Avatar 未完成命令；执行已释放 staging 和未采用 copy candidate 的清理；核对 unknown/迟到 IO 和唯一 cleanup ACK | **Physical Transfer Cleanup Pending 为零**；满足全部 generation settlement/ACK 后，同一有界事务删除 parts、binding 和 Session。Operation SET NULL 保留最小快照；可在此删除终结且解绑定的 AvatarChangeRequest。保留 Request/Reservation/Manifest 到 FINALIZE |
| FINALIZE | 独占 User fence、检查预准入 writer；有界删除 UploadCreationRequest、Reservation/Manifest 及既有其他历史；Quota/Inventory/Usage 零不变量；最后 User DELETE | **Final History Erasure Pending 为零**，无 Session/binding、无未解决物理责任，所有必要 FK 已解除。可保留独立物理 Operation/Retirement 证据，不等待正式对象 Retirement 完成 |

这三类 pending 是目标职责和查询语义，不是新建三份持久化状态或账本：

- Semantic pending 从业务事实读；Take API 必须将取消/删除与 input/candidate release admission 原子提交。
- Physical pending 只从 Objects Session/Copy/CLEANUP operation 读；`account_take_cleanup_pending()` 的目标不能再把它当作 TAKES 的 busy 条件。
  Reservation 不复制 `staging_cleanup_completed_at`；它只保留必要业务 release/候选 operation identity，ACK 由 Objects 读取。
- History pending 仅表示 FINALIZE 还需有界擦除的业务记录。`erase_account_take_history()` 的目标 guard
  先验证无语义资源、无 binding、且关联物理 ledger 已完成，再删 Reservation/Manifest；不能靠清空旧 JSON 掩盖未知候选。

**没有阶段等待其后阶段生产前置条件**：TAKES 先提交 release，TRANSFERS 只等待独立 Objects workers。
TRANSFERS 若发现缺失业务 release，应明确返回 semantic pending 并恢复对应业务阶段，不在本阶段猜测 Take 生命周期。
FINALIZE 在 Lu 下发现迟到语义资源则恢复 SCORES；发现尚存传输/unknown 责任则恢复 TRANSFERS；
仅历史未清理则留在 FINALIZE。busy/restart 都释放当前事务，不持 Lu 等网络或 Session worker。

User→Session 为 RESTRICT；parts→Session 为 RESTRICT；binding 显式 concrete FK 为 RESTRICT；
Operation→Session SET NULL，保留不可变 UUID/generation/key/result 快照，不含 User FK。
只有 Session 已终结、domain input 已释放、全部 physical operations 已 settled 且 ACK 完整时才解除 binding。
Session 清理失败时，Request/Reservation/Manifest 和唯一物理证据全部保留，不能以 User CASCADE 擦掉责任。
Take CANCELLED/EXPIRED 与 Quota RELEASED/EXPIRED 仍是独立状态；已 CONSUMED 的 H 不会改回 RELEASED。
正式 StoredObject adoption 过的对象只能由 Retirement 清理，TRANSFERS 不能直接删除它。

这些调整是现有 AccountDeletionOperation 的阶段职责扩展，不是新删除账本/queue。
需要在批准后的同一实现批次修改 Take pending predicates、executor 分支和 history guards；
不能只追加 TRANSFERS enum 而沿用旧 TAKES guard。当前生产实现没有被改动。

### B1. 签名准入和User→Session顺序

普通资源Lk与closure Ln兼容，**因此不能仅用Lk宣称关闭提交后不会再签发能力**。
目标part签发/renew采用短事务 `User FOR NO KEY UPDATE -> Session FOR UPDATE`，
重新验证active/not-deleted，再本地签名并记录绝对expiry，同事务提交。
closure同样持User Ln；它在已准入签发提交后才能写tombstone，后来的签发则读到closed并拒绝。
在closure之前已提交但响应还在网络中的URL仍是既有能力，不能承诺从浏览器撤回。
签发deadline不超过session hard deadline，不因续签延长Hold；禁止后台无User验证地生成part能力。
现有Lk资源准入继续保护final erasure，不把所有业务请求改成Ln。

创建业务command/Session/binding按domain parent→Lk（或签发时Ln）→容量→B→S；
Session/Operation worker不取User锁，也不插入带User FK的新观察事件。
FINALIZE持Lu后只做无网络终局检查；若需要拿尚忙的S/容量，使用非阻塞检查并返回busy，
不能持Lu等待一个需要User FK的producer。

### B2. 不能丢弃的物理责任

- 已发URL：关闭阻止新签发，不等于在途part停止。保存最晚capability expiry并等所有执行证据settled。
- UNKNOWN initiate：保持generation、exact key和所有发现的upload IDs；扫描只限定该generation，不猜业务owner。
- UNKNOWN complete：同时检查MPU和completed object；NoSuchUpload可能是完成，不是“没有对象”。
- Abort成功：还要等待/核验在途请求。一次空ListParts/对象404不能证明无限迟到IO不再出现。
- Cleanup ACK：必须绑定generation/phase attempt，保留verified observations及其时间；旧lease不能清新代证据。
- Session删除后的Operation快照：operation UUID、session UUID、generation、exact temporary key、已准入physical facts、
  provider upload IDs/候选ID及解决观察、phase/attempt/failure/cleanup时间。没有邮箱、filename、Signed URL、凭证。
  这些是不可变execution snapshots，不是可以重新启用的current state。
- User最终删除：所有业务资源为零、H无活跃占用、未apply Avatar终结、所有owned input释放、
  无未解决物理临时operation、binding/parts/session和domain历史依顺序解除，Inventory/Usage通过既有零不变量。
  不等待正式Retirement、不等备份销毁；终态最小快照保留期限仍需政策决定。

## C. 唯一采用和Copy证据

**APPROVED（既有）**：StoredObject immutable facts、9个RESTRICT引用、I→O→R、irreversible deletion fence。
**UNRESOLVED（目标接口）**：以下接口语义需负责人接受后才能写生产代码。

```text
WrittenObjectReceipt = (intent_uuid, write_generation_token)
VerifiedCandidateReceipt = (copy_operation_uuid, copy_generation_token)

adopt_object(db, evidence: WrittenObjectReceipt | VerifiedCandidateReceipt)
    -> AdmittedObjectReference
```

Receipt只携带不可预测的identity/generation；**不接收调用者指定的facts作为authority**。
公开的`StoredObjectFacts(key,size,sha,type)`只是值，不赋予创建StoredObject的权利。
唯一admission实现位于Objects；从自己的持久化ledger `FOR UPDATE` 读取exact key、完整SHA、size、type、
已完成verification和state，核对receipt token、未释放/未清理、未过期准入，再锁O/R检查fence。
伪造DTO、旧token、未WRITTEN/未VERIFIED、错误size/hash/key或已释放operation全部拒绝。
业务不得直接调用mapper/INSERT StoredObject；AST/import规则和实际DB拒绝测试共同保护此边界。
Python私有构造器不是安全证明；持有任意SQL权限的恶意进程不在“类型安全”能防御的边界内。

只有Objects的server-write verifier和candidate-copy verifier能发布可采用的持久化证据。
候选在完整、不可继续写的generation下流式hash，并验证长度/type；Part checksum/ETag/metadata不替代完整SHA。
正常post-adoption可重入只可retain同facts的现有O；已Retirement fence的O仍拒绝。

Take只把物理copy执行移交Objects：自身持久化Manifest、finalize token、expected key/bytes/type与copy operation FK。
Take Writer在业务parent/User/capacity/Reservation锁下验证精确live lease与Manifest；
Objects随后验证physical ledger，不读取Take ORM，不判断Score授权或Take ready。
采用O、Take row、Reservation完成、H消费、Usage allocation和copy evidence采用ack同一caller事务。
这才是统一采用；只移动`object_to_row`不算完成。

### C1. Copy Operation的唯一职责

- Intent-driven copy：`ObjectWriteIntent.copy_operation_id`明确FK；write token与copy generation不可变绑定。
  Take candidate：Reservation current/orphan lineage显式引用copy operation；不是把Take改成Intent状态机。
- Copy operation持久化source immutable identity/version、target、generation、MPU handle/parts、
  full target SHA/size/type、physical phase和existing delivery lease。Provider调用只由Objects executor执行。
- 每target一个**未释放generation**的唯一约束必须独立于delivery status：FAILED/expired lease不释放target。
  PREPARING/PROCESSING/未知COMMIT不能靠“换token”放行新的相同target覆盖。
- 旧generation未确认settled/cleanup前，另一个copy不能写同target。canonical Intent key复用必须继续遵守I/O/R fence；
  Take新lease使用新target，旧target保留operation清理权，不能被新lease接管后丢掉。
- 只有完成MPU、source不可再写、完整target verification已持久化且当前generation没有被释放，才可adopt。
  Copy success/HTTP200本身不是证据；VERIFY失败保持recoverable owner。
- 物理copy成功、publication COMMIT未知：fresh Session查operation/generation/phase与exact target，完整核验后收敛；
  没有确认前不建立O、不删除可能已采用的target、不新建同target copy。
- adoption COMMIT未知：fresh Session查询physical ledger的adoption ack和domain command/result/H/Usage原子组合。
  物理ledger ack与semantic FK必须同事务；若已采用，临时cleanup永久失去直接delete权。
- 未采用target只有copy cleanup能在持久化release和settled证据后删除；正式O只由Retirement删除。
  Cleanup发现O存在应重新核对已提交采用事实并fail closed，不能用“对象同key”推断可删除。

## D. Session Binding与字段authority

### D1. 拒绝“只有每表UNIQUE就够了”

Task 0的仅靠服务端创建纪律方案不足以提供跨表结构证明，标记 **REJECTED（撤回本 RFC 旧建议，不是撤销 Accepted Contract；替代提案仍待负责人批准）**。
推荐增加明确的FK arc表 `upload_session_bindings`，不是 `owner_type/owner_id`：

```text
session_id PRIMARY KEY -> upload_sessions RESTRICT
user_id + command_generation
upload_creation_request_id nullable -> UploadCreationRequest RESTRICT
avatar_change_request_id nullable   -> AvatarChangeRequest RESTRICT
take_reservation_id nullable        -> PerformanceTakeUploadReservation RESTRICT
CHECK num_nonnulls(the three concrete FKs) = 1
UNIQUE(concrete_command_id, command_generation) for each concrete relation
composite (id,user_id) FKs to Session and each command
```

**UNRESOLVED 新提案**：UUID 完全由服务端产生；三个 domain admission 在同一事务创建自己的 command、
Session 和 concrete binding，不存在客户端重新绑定已有 Session 的 API。各业务表不保存第二份可修改 Session FK。

基础 FK arc 只保证 **at-most-one** binding 和 row 内 exactly-one concrete FK；它本身不保证每个 Session 都有 binding，
也不禁止 UPDATE。Task 0.2 的 [隔离 SQL 原型](../../backend/tests/test_asset_session_binding_design_postgres.py)
另测试下列提案，不创建生产 ORM/Migration：

| 保证 | 数据库原型的机制 | 不属于该机制的保证 |
| --- | --- | --- |
| 不可 retarget | BEFORE UPDATE trigger 比较 session/user/generation/三个 command FK，任意 identity 改变报 23514；no-op 可接受 | 不仅是 Repository 不提供 UPDATE；应用没有禁用 trigger/TRUNCATE 权限是部署前提 |
| 跨域全局 at-most-one | binding 的 Session PK；CHECK num_nonnulls=1；User composite FK | 不代表 Session 无 binding 时也满足 exactly-one |
| 每 command/generation 至多一 Session | 三个具体 UNIQUE；并发第二事务在真实 unique-key 等待后失败 | binding 最终删除后，已完成业务 command 不能再次准入仍由 domain 终态/幂等 lineage 保证，不能声称 UNIQUE 永久保存历史 |
| 每个已提交 Session 恰有一 binding | Session AFTER INSERT/UPDATE 的 DEFERRABLE INITIALLY DEFERRED constraint trigger，在 commit 核实 binding | 同一 admission 事务内可先建 Session 后建 binding；不能独立提交未绑定 Session |
| 受控删除、不可删除后重绑 | BEFORE DELETE 核对 Session terminal 和唯一 Objects cleanup result；binding DELETE 的 deferred trigger 要求同事务 Session 也已删除，即使 DELETE+INSERT 重绑仍拒绝 | 真实物理 settlement 由 Objects protocol 负责，数据库 flag 不能证明外部 IO 已永久停止 |
| 删除原子性 | 先锁 Session 再核对 ledger，删除 parts、binding、Session（FK RESTRICT）；提交时反向一致性 guard；故障 rollback 恢复两者 | 在物理 ACK 未成立前不允许断 FK；业务历史之后由 FINALIZE 清理 |

原型用 `gate_cleanup_operations` 独立保存模拟 ACK，不在 Session/Reservation 复制 ACK；
Session 删除使该 operation FK SET NULL，snapshot/ACK 仍在。真实实现必须核对 Objects 的精确 generation、
release 与全部 settled operations；原型不构成 N3 的物理终结证明。
原型没有提交孤立 Session、没有允许终态 Session 跨域重绑；已删除 Session 的旧 ID 不能通过 FK 再绑定。
“永不重用已删除 UUID”、业务身份和媒体/所有权准入仍是服务端生成规则及 Domain Admission 的责任，
不能把普通 SQL 权限能手工重建任意行的行为混为外部产品 API 保证。

SQL 原型验证 UPDATE/DELETE+INSERT、各 domain generation 唯一性和并发、无 binding 提交失败、
清理前 unlink 拒绝、同事务删除与 rollback、父记录 RESTRICT。这里只证明设计约束，不表示已获实施批准。

### D2. Current state与execution history分离

| 字段 | 唯一current authority | 允许的history / 约束 |
| --- | --- | --- |
| generation | Session immutable transfer generation；domain command_generation是独立的业务重试序号 | Operation保存不可变session generation snapshot；更换physicalgeneration创建新Session，不原地改旧值 |
| staging_key | Session不可变exact locator | Operation可保存cleanup必需的不可变snapshot，不能成为另一个可修改的current locator |
| provider_upload_id | INITIATE Operation的成功result ledger | Session不再独立维护可修改upload ID，只引用/读取已匹配的INITIATE结果；unknown orphan IDs也是operation evidence |
| phase | Session.state表示应用可见传输进度；Operation.phase表示某一固定physical命令kind | 两者不是相同“phase”双写：Operation row的kind不可变；成功publication事务推进Session并登记下一operation |
| attempt token | Operation的DurableDeliveryLifecycle | Session不保存第二份current attempt；旧receipt核对Operation token/generation |
| input release | Session.input_released_at一次性domain release事实 | Operation执行cleanup，不能反过来改Take保留政策 |
| cleanup acknowledgment | CLEANUP Operation的匹配attempt result ledger | Session/Reservation只通过contract读取该唯一ACK，不复制cleanup_completed_at；没有完整settled证据不能完成ACK |
| verified facts | Objects VERIFY ledger不可变result，Session投影只引用匹配verification identity | 不能两边分别改SHA/size；adoption总读取ledger，不相信projection cache |

关键结果（INITIATE upload ID、VERIFY facts、cleanup ACK）和Session状态推进必须一个DB事务提交，
不做“先更新Session、稍后异步复制operation”的dual write。旧operation终态是历史结果，不会成为新generation的当前authority。
Session删除仅在全部physical责任关闭后；Operation保留snapshot独立于User，但不提供重新激活资源的授权。

## E. Provider证据与尚未关闭的门槛

详见 [Provider qualification](asset-provider-qualification.md) 及其中原始脱敏JSON。
开发实际为阿里云OSS，不能继续把Compose MinIO当作实际开发或生产能力证据。
生产Provider仍UNKNOWN；完整IAM/加密策略、在途IO永久结束边界、最大尺寸和composite checksum资格未获证明。
本批的真实小对象通过不能填补这些结论。

## F. N1–N8状态

| 项 | 状态 | 结论 / 下一证据 |
| --- | --- | --- |
| N1 所有browser ingress multipart、Avatar command | UNRESOLVED | 仍为提案；小Avatar请求成本/产品选择未被负责人接受 |
| N2 Provider/version/config | BLOCKED | 开发OSS托管服务已核实且部分能力实测；生产模板无实际Provider，managed版本、完整IAM/加密信息不足 |
| N3 迟到IO/unknown结果 | BLOCKED | orphan发现和有界并发观测存在；无限迟到结果的结束证据未证明，且bucket未配置incomplete-MPU lifecycle |
| N4 参数/size/copy/checksum | UNRESOLVED | 5MiB只是测试payload；未设置产品part size/TTL/最大对象；single-copy上限未实测；checksum响应不充分 |
| N5 Account erasure / evidence retention | UNRESOLVED | TAKES semantic / TRANSFERS physical / FINALIZE history 分工消除循环；新增phase、触发器与证据保留仍待批准 |
| N6 切换/历史数据 | UNRESOLVED | 仍推荐排空在途single-PUT；未执行数据迁移/清库，无兼容运行时实施 |
| N7 adoption/copy/authority | UNRESOLVED | Opaque receipt + DB ledger + same-transaction adoption ACK，待接口审查与实现验证 |
| N8 locks/binding | UNRESOLVED | 当前A/C/H与Objects条件层级已审计；跨User真实Upload路径与binding原型新增验证；新生产实现尚不存在，不宣称已获无死锁资格 |

没有新增提案被自动标为APPROVED。现有accepted Objects/Usage/Quota/Inventory/Take/Account合同继续有效；
本批明确不改变生产代码、ORM、迁移、API、Frontend、运行时Provider或已批准ADR。

## G. Task 0.2 Review Findings

| Finding ID | Severity | Source | Resolution | Test Evidence | Remaining Risk | Approval Status |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | HIGH | Provider cleanup | 每次 Abort/Delete 独立隔离全部 Exception；prefix 分页发现；最终分别核验 MPU/object/version/marker；任意未知或错误 BLOCKED | probe logic suite；真实 schema=2 OSS 四项零遗留及逐阶段记录 | 有界观察不能证明 Provider 内部无限迟到 IO 永久结束 | 工具修复已验证；架构 UNRESOLVED |
| A2 | HIGH | orphan_discovery | 移除 self.uploads 登记；按 exact key 发现、比较 oracle、只用发现 ID Abort并重查 | 独立工具测试 + OSS application_registration_removed/discovered_handle_matches/aborted_using_discovered_handle | 未模拟真实网络响应丢失或 Provider 内部迟到 | 修复已验证；N3 BLOCKED |
| A3 | MEDIUM | 签名 URL 文件与 barrier | 删除两个 CLI 出口，仅 subprocess stdin 传递 URL | CLI 拒绝旧参数；write_text 禁用时 browser probe 仍可执行；临时目录为空 | 子进程/进程内存安全属于部署边界，不宣称 URL 可即时撤销 | 工具修复已验证 |
| A4 | HIGH | CORS/checksum/lifecycle 标签 | preflight 五条件；三响应 checksum 检查仍不提升 full/composite 资格；无 lifecycle 直接 BLOCKED | 条件缺失 unit cases；OSS preflight 五项 true，checksum UNKNOWN / lifecycle BLOCKED | 正式 Origin、checksum 语义、策略待负责人 | N2/N3/N4 未升级 |
| B1–B3 | HIGH | FK arc 原型 | immutable UPDATE trigger、三组 UNIQUE、deferred exactly-one/paired delete；唯一 ACK 仅在 operation | 23 项真实 PostgreSQL 原型测试，含并发、DELETE+INSERT、rollback 和 evidence SET NULL | 原型不验证外部物理 settlement；生产 DDL/权限/完整状态机尚未实现 | 新设计 UNRESOLVED |
| C | HIGH | TAKES / TRANSFERS | 分开 semantic / physical / history pending；TAKES 不等物理 ACK，FINALIZE 擦除历史 | 本文 Phase/Resource/Completion matrix 对照真实 cleanup/executor 源码 | 仅文档修正，未来须同批修改所有 guard；不能只追加 phase | UNRESOLVED |
| D | HIGH | 跨 User 共享 blob 假设 | 保留并缩窄到已审计 canonical Upload 调用链的结论 | 真实 UploadService、独立 A、同步屏障、pg_blocking_pids、每 User 用量与共享删除验证通过 | 不覆盖尚不存在的 Session/Copy 全系统锁图 | 当前行为已验证；N8 UNRESOLVED |
| E | HIGH | Provider 决策输入 | RFC Owner Decision Checklist 列出 13 项明确输入 | 保留原始 JSON并新增 schema=2；没有 bucket 配置写入 | 生产/权限/参数仍 UNKNOWN；MinIO 固定 tag 拉取 BLOCKED | 未获 Task 1 授权 |

## 本地验证记录

2026-11-26，既有 quality container / PostgreSQL 17；只在项目专用测试 DB
`noteverse_test_provenance` 的临时 schema 执行 SQL 原型，不修改生产 Schema/Migration。
Backend 命令从 `/repo/backend` 执行；PG 行通过 quality container 的 Python entry 设置测试 URL 后
调用 `pytest.main([...])`（下表用等价 CLI 展开测试选择）；PG fixture 使用
`NOTEVERSE_TEST_PRACTICE_BUNDLE_POSTGRES_URL` 指向该测试 DB，凭据不输出。

| 实际命令 | 最终输出 |
| --- | --- |
| `python -m pytest -q tests/test_asset_gate_postgres.py` | `5 passed, 1 warning in 28.81s` |
| `python -m pytest -q tests/test_asset_session_binding_design_postgres.py` | `23 passed, 1 warning in 22.72s` |
| `python -m pytest -q tests/test_asset_provider_probe.py` | `21 passed, 1 warning in 6.37s`；仅工具逻辑 doubles |
| `python -m pytest -q tests/test_object_write_postgres.py tests/test_stored_object_retirement_postgres.py tests/test_upload_reservation_postgres.py tests/test_account_deletion_postgres.py tests/test_storage_quota_postgres.py` | `111 passed, 1 warning in 95.21s` |
| `python -m ruff check app tests scripts` | `All checks passed!` |
| `python -m ruff format --check tests` | **FAIL：10 files would be reformatted, 295 files already formatted**；10 项均是起点未改文件，见下方复核 |
| `python -m ruff format --check tests/support/qualify_asset_provider.py tests/test_asset_gate_postgres.py tests/test_asset_session_binding_design_postgres.py tests/test_asset_provider_probe.py` | `4 files already formatted` |
| `python -m mypy --config-file pyproject.toml` | `Success: no issues found in 488 source files` |
| `node --check tests/support/qualify_asset_provider_browser.mjs` | exit 0（宿主机从根目录加 backend/ 前缀执行同一文件） |
| `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/quality.ps1 -Check docs-links` | 11 tests OK；Documentation structure OK；Markdown links are valid |
| `git diff --check` | exit 0 |

格式基线复核：逐个 `git show 480bff01:backend/tests/<file>` 将起点源码通过 stdin 交给相同容器的
`ruff format --check --stdin-filename tests/<file>`；全部返回 1，并确认本批对这些文件 `git diff --quiet HEAD`。
未为了通过门禁修改以下无关文件：
`test_health_api.py`、`test_image_contract.py`、`test_practice_physical_strike_contract.py`、
`test_practice_render_identity_contract.py`、`test_practice_score_artifact.py`、`test_practice_score_time.py`、
`test_prepare_model_assets.py`、`test_public_frontend_url_settings.py`、`test_text_integration.py`、`test_trusted_proxy_settings.py`。
这是已确认的基线格式失败，不将全量 format 描述为通过。

初次新增跨 User fixture 重复 provision 已存在的 user 1，导致唯一键失败（1 failed / 27 passed）；
修正 fixture 为仅 provision 新 user 2 后，按以上最终命令重新运行并通过，没有修改生产逻辑或放宽断言。
pytest warning 是既有 FastAPI/Starlette TestClient 的 httpx 弃用提示。

真实 OSS 运行命令为 `python tests/support/qualify_asset_provider.py --run-isolated --browser-script tests/support/qualify_asset_provider_browser.mjs`，
S3 配置经内存/stdin 传入；[脱敏原始结果](evidence/asset-provider-oss-review-02.json) 记录最终四类库存均为零。
只执行一次本批真实运行；没有更改 bucket 配置、没有触碰生产、没有用 mock 代替资格证据。
完整 Backend/Frontend、Build、Alembic/API regeneration 未执行：本批只修改允许的测试和架构材料。
Hosted CI 未查询、未等待；Task 1 仍未获授权。
