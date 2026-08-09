param(
    [ValidateSet(
        "backend-ruff",
        "backend-mypy",
        "backend-mypy-model-layer",
        "backend-pytest",
        "backend-coverage",
        "backend-critical-coverage",
        "backend-critical-import-execution-coverage",
        "backend-contracts",
        "customer-web-lint",
        "customer-web-typecheck",
        "customer-web-i18n",
        "customer-web-api-types",
        "customer-web-test",
        "customer-web-coverage",
        "platform-admin-lint",
        "platform-admin-typecheck",
        "platform-admin-test",
        "platform-admin-build",
        "docs-links",
        "k8s",
        "k8s-minikube",
        "observability",
        "all"
    )]
    [string] $Check = "k8s"
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$BackendQualityScript = Join-Path $PSScriptRoot "backend_quality_docker.ps1"
$CustomerWebRoot = Join-Path $RepoRoot "apps/customer-web"
$PlatformAdminRoot = Join-Path $RepoRoot "apps/platform-admin"
$K8sManifestCheck = Join-Path $PSScriptRoot "check_k8s_application_manifests.py"
$K8sReleaseOverlayRenderer = Join-Path $PSScriptRoot "render_k8s_release_overlay.py"
$MinikubeBootstrap = Join-Path $PSScriptRoot "minikube_bootstrap.ps1"
$ObservabilityManifestCheck = Join-Path $PSScriptRoot "check_observability_manifests.py"

function Invoke-Step {
    param(
        [string] $Name,
        [scriptblock] $Command
    )

    Write-Host "==> $Name"
    & $Command
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}

function Invoke-BackendQuality {
    param([string] $BackendCheck)

    Invoke-Step "backend:$BackendCheck" {
        powershell -NoProfile -ExecutionPolicy Bypass -File $BackendQualityScript -Check $BackendCheck
    }
}

function Invoke-CustomerWebNpm {
    param([string] $Script)

    Invoke-Step "customer-web:$Script" {
        Push-Location $CustomerWebRoot
        try {
            npm run $Script
        }
        finally {
            Pop-Location
        }
    }
}

function Invoke-PlatformAdminNpm {
    param([string] $Script)

    Invoke-Step "platform-admin:$Script" {
        Push-Location $PlatformAdminRoot
        try {
            $env:NEXT_CONTROL_PLANE_ORIGIN = "http://127.0.0.1:8002"
            $env:NEXT_PUBLIC_CONTROL_PLANE_CSRF_COOKIE_NAME = "noteverse_operator_csrf"
            $env:NEXT_PUBLIC_CONTROL_PLANE_CSRF_HEADER_NAME = "x-operator-csrf-token"
            npm run $Script
        }
        finally {
            Pop-Location
        }
    }
}

function Invoke-K8sManifestCheck {
    Invoke-Step "k8s:application-manifests" {
        python $K8sManifestCheck
    }
}

function Invoke-K8sReleaseOverlaySmokeCheck {
    $OutputDir = Join-Path $RepoRoot "build/k8s-release-check/staging"
    $OutputRoot = Join-Path $RepoRoot "build/k8s-release-check"

    Invoke-Step "k8s:release-overlay-renderer" {
        if (Test-Path $OutputRoot) {
            Remove-Item -Recurse -Force $OutputRoot
        }

        python $K8sReleaseOverlayRenderer `
            --environment staging `
            --output $OutputDir `
            --backend-api-image "ghcr.io/example/noteverse/backend-api@sha256:1111111111111111111111111111111111111111111111111111111111111111" `
            --backend-practice-image "ghcr.io/example/noteverse/backend-practice@sha256:5555555555555555555555555555555555555555555555555555555555555555" `
            --backend-beat-image "ghcr.io/example/noteverse/backend-beat@sha256:4444444444444444444444444444444444444444444444444444444444444444" `
            --backend-worker-image "ghcr.io/example/noteverse/backend-worker@sha256:3333333333333333333333333333333333333333333333333333333333333333" `
            --customer-web-image "ghcr.io/example/noteverse/customer-web@sha256:2222222222222222222222222222222222222222222222222222222222222222" `
            --platform-admin-image "ghcr.io/example/noteverse/platform-admin@sha256:6666666666666666666666666666666666666666666666666666666666666666" `
            --customer-web-host "staging.noteverse.test" `
            --admin-host "admin.staging.noteverse.test" `
            --tls-secret "noteverse-staging-real-tls" `
            --customer-web-base-url "https://staging.noteverse.test" `
            --backend-cors-origins '["https://staging.noteverse.test"]' `
            --control-plane-cors-origins '["https://admin.staging.noteverse.test"]' `
            --trusted-proxy-cidrs '["10.244.0.0/16"]' `
            --auth-cookie-secure true `
            --mail-default-sender "NoteVerse Pro <no-reply@staging.noteverse.test>" `
            --s3-endpoint-url "https://object-storage.noteverse.test" `
            --s3-region "auto" `
            --s3-bucket "noteverse-staging" `
            --s3-public-base-url "https://objects.staging.noteverse.test" `
            --s3-force-path-style true `
            --s3-presign-expire-seconds 900

        python $K8sManifestCheck $OutputDir --strict
    }
}

function Invoke-ObservabilityManifestCheck {
    Invoke-Step "observability:manifests" {
        python $ObservabilityManifestCheck
    }
}

function Invoke-DocumentationLinkCheck {
    Invoke-Step "docs:links" {
        python (Join-Path $PSScriptRoot "check_markdown_links.py")
    }
}

function Invoke-MinikubeBootstrapCheck {
    Invoke-Step "k8s:minikube-bootstrap" {
        powershell -NoProfile -ExecutionPolicy Bypass -File $MinikubeBootstrap -ValidateTracing
    }
}

switch ($Check) {
    "backend-ruff" {
        Invoke-BackendQuality "ruff"
    }
    "backend-mypy" {
        Invoke-BackendQuality "mypy"
    }
    "backend-mypy-model-layer" {
        Invoke-BackendQuality "mypy-model-layer"
    }
    "backend-pytest" {
        Invoke-BackendQuality "pytest"
    }
    "backend-coverage" {
        Invoke-BackendQuality "coverage"
    }
    "backend-critical-coverage" {
        Invoke-BackendQuality "critical-coverage"
    }
    "backend-critical-import-execution-coverage" {
        Invoke-BackendQuality "critical-import-execution-coverage"
    }
    "backend-contracts" {
        Invoke-BackendQuality "contracts"
    }
    "customer-web-lint" {
        Invoke-CustomerWebNpm "lint"
    }
    "customer-web-typecheck" {
        Invoke-CustomerWebNpm "typecheck"
    }
    "customer-web-i18n" {
        Invoke-CustomerWebNpm "check:i18n-errors"
    }
    "customer-web-api-types" {
        Invoke-CustomerWebNpm "check:api-types"
    }
    "customer-web-test" {
        Invoke-CustomerWebNpm "test"
    }
    "customer-web-coverage" {
        Invoke-CustomerWebNpm "test:coverage"
    }
    "platform-admin-lint" {
        Invoke-PlatformAdminNpm "lint"
    }
    "platform-admin-typecheck" {
        Invoke-PlatformAdminNpm "typecheck"
    }
    "platform-admin-test" {
        Invoke-PlatformAdminNpm "test"
    }
    "platform-admin-build" {
        Invoke-PlatformAdminNpm "build"
    }
    "docs-links" {
        Invoke-DocumentationLinkCheck
    }
    "k8s" {
        Invoke-K8sManifestCheck
        Invoke-K8sReleaseOverlaySmokeCheck
    }
    "k8s-minikube" {
        Invoke-MinikubeBootstrapCheck
    }
    "observability" {
        Invoke-ObservabilityManifestCheck
    }
    "all" {
        Invoke-BackendQuality "ruff"
        Invoke-BackendQuality "mypy"
        Invoke-BackendQuality "mypy-model-layer"
        Invoke-BackendQuality "pytest"
        Invoke-CustomerWebNpm "lint"
        Invoke-CustomerWebNpm "check:api-types"
        Invoke-CustomerWebNpm "typecheck"
        Invoke-CustomerWebNpm "check:i18n-errors"
        Invoke-PlatformAdminNpm "lint"
        Invoke-PlatformAdminNpm "typecheck"
        Invoke-PlatformAdminNpm "test"
        Invoke-DocumentationLinkCheck
        Invoke-K8sManifestCheck
        Invoke-K8sReleaseOverlaySmokeCheck
        Invoke-ObservabilityManifestCheck
    }
}
