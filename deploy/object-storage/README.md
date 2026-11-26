# Private object storage deployment

API, Worker and Beat use one private bucket per environment. Runtime credentials
have object read/write/copy/delete, multipart create/list/complete/abort, exact-key
multipart discovery and required version-cleanup permissions. Bucket policy, CORS,
lifecycle, encryption and IAM administration belong to the deployment operator.
Runtime processes never change bucket configuration.

The [OSS CORS example](oss-cors.example.xml) authorizes direct PUT and signed
GET/HEAD. Replace the placeholder with each exact Customer Web origin, including
local development origins as needed. Upload requests omit cookies. The browser
sets Content-Length from the Blob; the server signs its exact value. ETag and
transport headers are exposed. Verify real browser preflight and PUT using the
external signing endpoint; a readable CORS document alone is not qualification.
See [OSS CORS](https://www.alibabacloud.com/help/en/oss/user-guide/configure-cross-origin-resource-sharing/).

The [OSS lifecycle example](oss-lifecycle.example.xml) uses a three-day operational
safety window, exceeding the 24-hour session deadline and 15-minute capability TTL.
It aborts incomplete MPU tasks and expires only disposable `transfers/` objects,
including noncurrent staging versions. It never expires completed final object keys.
Review the window against configured deadlines, maximum in-flight request duration,
versioning, Object Lock and deployment policy before applying. Lifecycle is a
secondary cleanup mechanism, not a replacement for persistent session cleanup.
Daily provider execution is asynchronous; a lifecycle rule does not prove an unknown
request has permanently stopped. See [OSS lifecycle](https://www.alibabacloud.com/help/en/oss/developer-reference/putbucketlifecycle).

These are deployment inputs, not evidence of applied bucket settings. Production
provider, IAM, encryption/KMS, backup and legal retention remain operator-owned.
Never apply a catch-all completed-object expiration rule to this bucket.

Celery Beat registers object-write cleanup, StoredObject retirement/session GC and
Take media processing maintenance. API, Worker and Beat share transfer limits from
the backend ConfigMap; Worker-specific model paths remain in the Worker ConfigMap.
See [media recovery](../../docs/operations/runbooks/media-storage-recovery.md).
