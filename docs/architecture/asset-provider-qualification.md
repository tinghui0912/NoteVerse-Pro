# Asset Provider Qualification — Task 0.2

状态：**部分开发环境能力已实测，完整实施门槛尚未关闭。**
复核基准 `480bff0180bd1d74f60679f23a0e0df362701b08`，2026-11-26（Asia/Shanghai）。
保留 Task 0.1 原始证据，不覆盖或删除；新报告 schema=2。
本报告是 [RFC](asset-infrastructure-rfc.md) 的证据，不是 Accepted Provider Contract。

## 环境与凭据边界

实际开发配置取自本机既有 `backend/.env.docker`，仅提取 S3 配置经 stdin 交给隔离工具，
没有提交该文件、凭据、Signed URL、邮箱、bucket 名或原始 Provider 错误正文。
生产配置不能从开发凭据推断，也没有对任何生产 bucket 执行测试。

| 环境 | 已核实事实 | 结论 |
| --- | --- | --- |
| 实际开发 | HTTPS 阿里云 OSS；真实响应 `Server: AliyunOSS`；bucket 指纹 `137f2c244ed0`；virtual-hosted addressing；显式 signing endpoint 未配置，等于 SDK endpoint | Provider 家族已证实；托管服务内部版本 UNKNOWN |
| Compose 声明 | [Compose](../../docker-compose.backend-dev.yml) 固定 MinIO `RELEASE.2025-04-22T22-12-26Z` | 不是本次实际开发 Provider，不用 OSS 结果替其背书 |
| staging 配置 | [GitOps 配置](../../deploy/gitops/environments/staging/backend-config.env) 使用 OSS endpoint | 只证明部署配置意图，没有使用 staging 运行时验证 |
| production | [应用模板](../../deploy/application/overlays/production/backend-config.env) 使用 example.invalid；GitOps production 无可核实的实际 endpoint | **UNKNOWN / BLOCKED**，需负责人提供目标 Provider 和策略证据 |
| SDK | boto3 `1.43.114`，SigV4；`payload_signing_enabled=False`；checksum when_required；自动尝试总数 1 | 与调查到的应用配置方式匹配，不因 SDK 有方法便推断 Provider 支持 |

本地文件中的旧 `S3_PUBLIC_BASE_URL` / `S3_PRESIGN_EXPIRE_SECONDS` 不是当前
`S3_SIGNED_ENDPOINT_URL` / `OBJECT_STORAGE_SIGNED_URL_EXPIRE_SECONDS` 的替代 authority；
工具没有把旧字段隐式映射为新的运行时行为，也没有修改生产配置。

Task 0.1 曾实际尝试 `docker pull minio/minio:RELEASE.2025-04-22T22-12-26Z`，Docker 返回
`pull access denied ... repository does not exist or may require docker login`。
因此固定 MinIO 的独立资格验证 **BLOCKED**，没有将别的 MinIO tag 或 OSS 结果冒充该版本实测。

## 可复核实验

独立工具：[Python probe](../../backend/tests/support/qualify_asset_provider.py)、
[Chromium probe](../../backend/tests/support/qualify_asset_provider_browser.mjs)。
只允许显式 `--run-isolated`，每次生成随机 `architecture-qualification/<uuid>/` 前缀，
每个 delete/abort 均限制于自己生成的 key/MPU。末尾 finally 中逐项清理，并分别分页核实 MPU、对象、版本和 Delete Marker。
每个 Abort/Delete 的任何异常独立记录，不能阻断下一项；发现的 MPU 也按当前随机 prefix 精确核对后 Abort。
最终任一枚举失败、残留非零、清理阶段失败或仍有不确定 IO，cleanup 均为 BLOCKED，不能把未知数输出成零。
没有修改 bucket policy、CORS、versioning、lifecycle，没有删除 bucket 或扫描重建业务归属。

原始脱敏结果：

- [Docker 运行](evidence/asset-provider-oss-container.json)：UTC 15:02；基础流程通过，
  并发组遇到 `ConnectionClosedError`，浏览器尚未执行；该失败保留，不以重试掩盖。
- [宿主机完整运行](evidence/asset-provider-oss-host.json)：UTC 15:11；Windows 到 OSS，
  包括真实 Chromium 和在途 body 屏障。
- [Task 0.2 OSS 运行](evidence/asset-provider-oss-review-02.json)：UTC 2026-11-25 16:31（本地 11-26 00:31）；
  修复工具后的真实执行；下面的 cleanup/orphan/CORS/checksum 结论以此 schema=2 结果为准。

Task 0.1 原始 JSON 的 cleanup PASS 只包含当时对象/MPU 观察，**未完整验证版本/Delete Marker**，
旧 orphan 测试还保留了 self.uploads 中的原始 handle；不能把那些标签解释成 Task 0.2 新标准已经满足。
Task 0.2 namespace 的最终 MPU、对象、版本和 Delete Marker 四项均为 0；各清理阶段 PASS，unsettled_io=false。
PASS 只表示该次有界实验的断言满足；不是永久无竞态、请求体上限或迟到 IO 结束保证。

| 要求 | 实际结果 | 资格边界 |
| --- | --- | --- |
| CreateMultipartUpload | PASS | 创建返回可用 handle |
| UploadPart / 相同编号覆盖 | PASS；非末片 5,242,880 bytes，完整读回证明替换字节 | 这是测试 payload，不是最终 part size 产品参数 |
| ListParts 分页 | PASS；MaxParts=1，跨两页获得 2 parts | 不需要数 GB 才能验证分页 |
| Complete | PASS，HTTP 200，读回全量 SHA-256 匹配 | 独立哈希验证；不依赖 ETag 是 SHA |
| 200 内嵌错误 | UNKNOWN；实际错误 ETag 返回 InvalidPart / HTTP 400 | 未人为伪造 Provider 200 响应；SDK 行为不能替代真实能力证据 |
| NoSuchUpload 与 complete 区别 | PASS；ListParts 不存在，同时 HEAD 完整对象存在 | 不把 NoSuchUpload 当作“物理对象不存在” |
| Abort | PASS；MPU 不存在，完整对象不存在 | 单次成功不能证明在途写入已经永久停止 |
| 在途 UploadPart / Abort | PASS；已发送 HTTPS headers 和前 65,536 bytes 后才 abort，再释放剩余 body；part 返回 200，最终 0 parts | 证明实际请求体交错；不声称 Provider 内部收到/处理顺序 |
| Complete / Abort | 两调用均 accepted，MPU 不存在，**完整对象存在** | cleanup 必须检查完整 key；不能用 abort ACK 自动清除所有责任证据 |
| unknown initiate / orphan discovery | Task 0.2 PASS；从 self.uploads 移除原始 ID，经 exact key 分页发现、比对 oracle，用发现 ID Abort，再确认 MPU 与完整对象均不存在 | oracle 只作测试比较，不参与 cleanup；人为丢 receipt 不等于真实响应丢失，更不证明 Provider 内部迟到 IO 的结束边界 |
| full / composite checksum | UNKNOWN；请求 SHA-256 后 part/complete/HEAD 均未给出对应字段 | 全量读取独立哈希通过；未证明服务验证上传的 checksum，更未证明 composite 等于 full hash |
| CORS / ETag | Task 0.2 PASS；HTTP 200、Origin、PUT、content-type 允许且 ETag 暴露五条件均满足，另有实际浏览器请求 | allowed headers 仅 content-type、x-amz-meta-sha256；没有 checksum header 资格 |
| 外部签名 endpoint 浏览器可达 | PASS；Chromium 页面真实 fetch 到 OSS 返回 200，ETag 可见 | 仅本机 localhost Origin；空白 app 文档是 fixture，Provider 请求未 mock |
| Multipart Copy / UploadPartCopy | PASS，复制并读回 5,242,894 bytes | 不代表所有大小、分段范围、版本条件均已通过 |
| 单次 Copy 实际最大尺寸 | UNKNOWN；小对象 CopyObject 通过 | 没有 GB 边界测试；不得以 AWS 上限代替 Aliyun 的兼容保证 |

Upload/Abort 与 Complete/Abort 还分别使用并发 HTTP 请求和同步 Barrier 同时发起，
没有 sleep、重试或延长 timeout 来避开交错。它们仅证明观察到的收敛结果，不是完整网络故障模型。

## Bucket 配置观察

- versioning：S3 查询未返回启用状态，工具记录 Disabled；不据此推断所有部署或备份策略。
- encryption / bucket policy：S3 API 返回 `OperationNotSupported` / HTTP 400，均为 UNKNOWN；
  不代表未加密或没有 IAM。已行使的 put/read/copy/delete/list 权限不等于完整最小权限审计。
- CORS：允许 GET/HEAD/PUT，暴露 Content-Length、Content-Type、ETag。
  checksum header 的 Allow/Expose 资格不足；真实产品 Origin 和 CDN/代理仍待验证。
- checksum：资格同时检查 part/complete/HEAD 的字段；即使三者都有且匹配单片摘要，整体仍 UNKNOWN，
  不能从字段存在推导 full/composite 语义或服务真正验证了错误摘要。完整读回字节的本地 SHA 验证单独记录。
- lifecycle：读取成功观察 `NoSuchLifecycleConfiguration` / HTTP 404。
  **incomplete multipart 清理策略缺失，N3 BLOCKED**；schema=2 直接记录 BLOCKED，旧 schema=1 的 PASS 只是读配置结果。

## Provider 文档与参数约束

Aliyun 原生 OSS 的 [multipart 文档](https://www.alibabacloud.com/help/en/oss/user-guide/multipart-upload)
和 [UploadPart 文档](https://www.alibabacloud.com/help/en/oss/developer-reference/uploadpart)
说明其原生分片规则；[CopyObject 文档](https://www.alibabacloud.com/help/en/oss/developer-reference/copyobject)
给出原生单次复制 1 GB 上限，[CORS 文档](https://www.alibabacloud.com/help/en/oss/user-guide/configure-cross-origin-resource-sharing/)
说明浏览器头策略。它们是官方原生 API 依据，**不能未经验证直接转写为 S3-compatible port 的最终限制**。
AWS 文档仍可用于 SDK/参考协议分析，不是实际 OSS 的资格证明。

本批不确定最终 part size、会话/URL TTL、浏览器并发、Take 最大尺寸或 copy 最大尺寸。
已有图片/Avatar 限制仍只是既有业务政策。参数必须结合真实部署与产品成本测试再批准。

## 可重复执行方式

从 backend 目录执行，凭据只由本地进程读取并通过 stdin 传入：

```text
python tests/support/qualify_asset_provider.py --run-isolated \
  --browser-script tests/support/qualify_asset_provider_browser.mjs
```

stdin 为 JSON，只含 S3_ENDPOINT_URL、S3_SIGNED_ENDPOINT_URL（若实际配置）、
S3_ACCESS_KEY_ID、S3_SECRET_ACCESS_KEY、S3_BUCKET、S3_REGION、S3_FORCE_PATH_STYLE。
输出为安全 JSON；执行者必须先确认目标是获授权的开发 bucket。
Chromium 依赖 Customer Web 已安装的 Playwright。签名 URL 只在内存和子进程 stdin 中传递；
已删除 --browser-target-file 和 --browser-barrier，无持久化 URL 或未消费 barrier 接口。
此工具不改变应用运行时或 SDK lockfile。

独立 [工具逻辑测试](../../backend/tests/test_asset_provider_probe.py) 使用 doubles 验证错误隔离、分页、
版本/marker 清理、orphan 找回、最终核验和无文件出口；它们不是 OSS 实测，也不替代上述原始 JSON。

## 未关闭事项

生产 Provider/版本与 IAM/加密/CORS/lifecycle 配置 UNKNOWN；未知 initiate/complete/copy 的
永久结束证据 BLOCKED；200 内嵌错误、完整/composite checksum、最大对象/复制尺寸未获资格。
需要负责人确认实际生产目标并批准参数与最小证据保留政策。
没有证据时仍保留 cleanup owner，不能以短时间缺失观察宣布永久清理完成。


## 当前资格与负责人决策边界

| 项目 | 当前状态 |
| --- | --- |
| 实际开发 Provider | Aliyun OSS |
| Managed Provider 版本 | UNKNOWN |
| Production Provider / IAM / Encryption | 均 UNKNOWN |
| Incomplete MPU Lifecycle | 开发查询未配置；生产未获证明，BLOCKED |
| 完整 SHA-256 Provider 资格 | UNKNOWN；全量读取本地校验是独立证据 |
| Composite Checksum 语义 | UNKNOWN |
| Embedded HTTP 200 error | UNKNOWN；实际只观察到 HTTP 400 InvalidPart |
| 最大单次 Copy 尺寸 | UNKNOWN；小对象成功不代表最大值 |
| 迟到 IO 永久结束边界 | BLOCKED；零库存仅为有界观察 |
| 固定 MinIO 镜像资格 | BLOCKED；保留 Task 0.1 拉取拒绝证据，本批未替换 tag/来源，也未重复拉取 |

完整 13 项 [Owner Decision Checklist](asset-infrastructure-rfc.md) 由负责人提供依据和决策。
本次只使用获授权开发 bucket 的新随机 namespace，没有访问生产或修改任何 bucket 配置。
