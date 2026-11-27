# Private S3-compatible cloud storage

Development and cross-end tests use the configured real cloud bucket. Unit tests
and CI inject InMemoryObjectStorage or controlled SDK-boundary doubles. Each
cross-end run has an isolated PostgreSQL/Redis stack and unique resource identities.
No object-store container is part of the runtime or validation stack.

## Connection policy

The same adapter accepts OSS, COS, AWS S3 and R2 connection settings without vendor
branches. Each deployment supplies `S3_ENDPOINT_URL`, optional external
`S3_SIGNED_ENDPOINT_URL`, `S3_REGION`, `S3_BUCKET`, credentials and
`S3_FORCE_PATH_STYLE`. Use the provider's documented signing region and addressing
style. SigV4 is mandatory. This interface contract does not claim that every cloud
capability or bucket policy is qualified without real tests.

`S3_CONNECT_TIMEOUT_SECONDS=10` and `S3_READ_TIMEOUT_SECONDS=45` bound each SDK
attempt. Reads and idempotent abort/delete use standard transient retries with
`S3_MAX_ATTEMPTS=3` including the initial attempt. Put, Copy, CreateMultipart and
CompleteMultipart use one SDK attempt: their durable operation owner resolves any
ambiguous side effect. SDK retries do not replace durable application recovery.
See [SDK configuration](https://docs.aws.amazon.com/botocore/latest/reference/config.html).

## Browser and lifecycle policy

The [CORS input](cors.example.json) and [lifecycle input](lifecycle.example.json)
express standard S3 policy requirements. Operators apply the equivalent controls
through the selected cloud's supported API or console and verify the result.
Replace the example origin with exact Customer Web origins, including local test
origin `http://localhost:3000`. Upload requests omit cookies. The browser derives
Content-Length from Blob bytes; the server signs its exact value. Expose ETag and
transport headers. Browser E2E executes real cross-origin PUT and checks readable
ETag; request-library success alone does not establish browser CORS correctness.

The three-day lifecycle example exceeds default 24-hour sessions and 15-minute
capabilities. Review it against actual deadlines and maximum in-flight duration.
It aborts incomplete MPU and expires only disposable `transfers/` staging objects
and staging versions. It never expires completed final keys. Lifecycle is a
secondary backstop, not proof that unknown IO has permanently stopped.

These artifacts are deployment inputs, not evidence of applied bucket settings.
Runtime credentials do not administer CORS, lifecycle, encryption or IAM. Production
provider qualification, encryption/KMS, backup and legal retention remain separate
operator responsibilities. See [media recovery](../../docs/operations/runbooks/media-storage-recovery.md).
