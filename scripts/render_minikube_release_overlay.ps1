param(
    [string] $Output = "build/k8s-release/minikube",
    [string] $Environment = "staging",
    [string] $FrontendHost = "staging.johnabc.ccwu.cc",
    [string] $ApiHost = "api.staging.johnabc.ccwu.cc",
    [string] $AdminHost = "admin.staging.johnabc.ccwu.cc",
    [string] $TlsSecret = "noteverse-staging-tls",
    [string] $FrontendBaseUrl = "https://staging.johnabc.ccwu.cc",
    [string] $AuthCookieSecure = "true",
    [string] $S3PresignExpireSeconds = "900",
    [switch] $Overwrite
)

$ErrorActionPreference = "Stop"

function Get-RequiredEnv {
    param([string] $Name)

    $value = [Environment]::GetEnvironmentVariable($Name)
    if ([string]::IsNullOrWhiteSpace($value)) {
        throw "$Name is required."
    }
    return $value
}

if ($Environment -ne "staging") {
    throw "This wrapper is intentionally limited to the minikube staging rehearsal path."
}

$backendApiImage = Get-RequiredEnv "NOTEVERSE_BACKEND_API_IMAGE"
$backendPracticeImage = Get-RequiredEnv "NOTEVERSE_BACKEND_PRACTICE_IMAGE"
$backendBeatImage = Get-RequiredEnv "NOTEVERSE_BACKEND_BEAT_IMAGE"
$backendWorkerImage = Get-RequiredEnv "NOTEVERSE_BACKEND_WORKER_IMAGE"
$frontendImage = Get-RequiredEnv "NOTEVERSE_FRONTEND_IMAGE"
$platformAdminImage = Get-RequiredEnv "NOTEVERSE_PLATFORM_ADMIN_IMAGE"

$s3EndpointUrl = Get-RequiredEnv "NOTEVERSE_S3_ENDPOINT_URL"
$s3Region = Get-RequiredEnv "NOTEVERSE_S3_REGION"
$s3Bucket = Get-RequiredEnv "NOTEVERSE_S3_BUCKET"
$s3PublicBaseUrl = Get-RequiredEnv "NOTEVERSE_S3_PUBLIC_BASE_URL"
$s3ForcePathStyle = Get-RequiredEnv "NOTEVERSE_S3_FORCE_PATH_STYLE"

$mailDefaultSender = "NoteVerse Pro <no-reply@$FrontendHost>"
$backendCorsOrigins = "[`"$FrontendBaseUrl`"]"
$controlPlaneCorsOrigins = "[`"https://$AdminHost`"]"
$trustedProxyCidrs = Get-RequiredEnv "NOTEVERSE_TRUSTED_PROXY_CIDRS"

$args = @(
    "scripts/render_k8s_release_overlay.py",
    "--environment", $Environment,
    "--output", $Output,
    "--backend-api-image", $backendApiImage,
    "--backend-practice-image", $backendPracticeImage,
    "--backend-beat-image", $backendBeatImage,
    "--backend-worker-image", $backendWorkerImage,
    "--frontend-image", $frontendImage,
    "--platform-admin-image", $platformAdminImage,
    "--frontend-host", $FrontendHost,
    "--api-host", $ApiHost,
    "--tls-secret", $TlsSecret,
    "--frontend-base-url", $FrontendBaseUrl,
    "--backend-cors-origins", $backendCorsOrigins,
    "--control-plane-cors-origins", $controlPlaneCorsOrigins,
    "--trusted-proxy-cidrs", $trustedProxyCidrs,
    "--auth-cookie-secure", $AuthCookieSecure,
    "--mail-default-sender", $mailDefaultSender,
    "--s3-endpoint-url", $s3EndpointUrl,
    "--s3-region", $s3Region,
    "--s3-bucket", $s3Bucket,
    "--s3-public-base-url", $s3PublicBaseUrl,
    "--s3-force-path-style", $s3ForcePathStyle,
    "--s3-presign-expire-seconds", $S3PresignExpireSeconds
)

if ($Overwrite) {
    $args += "--overwrite"
}

python @args
