param(
    [ValidateSet(
        "backend-ruff",
        "backend-mypy",
        "backend-mypy-model-layer",
        "backend-pytest",
        "frontend-lint",
        "frontend-typecheck",
        "frontend-i18n",
        "frontend-test",
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
$FrontendRoot = Join-Path $RepoRoot "frontend"
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

function Invoke-FrontendNpm {
    param([string] $Script)

    Invoke-Step "frontend:$Script" {
        Push-Location $FrontendRoot
        try {
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
            --frontend-image "ghcr.io/example/noteverse/frontend@sha256:2222222222222222222222222222222222222222222222222222222222222222" `
            --frontend-host "staging.noteverse.test" `
            --api-host "api.staging.noteverse.test" `
            --tls-secret "noteverse-staging-real-tls" `
            --frontend-base-url "https://staging.noteverse.test" `
            --backend-cors-origins '["https://staging.noteverse.test"]' `
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
    "frontend-lint" {
        Invoke-FrontendNpm "lint"
    }
    "frontend-typecheck" {
        Invoke-FrontendNpm "typecheck"
    }
    "frontend-i18n" {
        Invoke-FrontendNpm "check:i18n-errors"
    }
    "frontend-test" {
        Invoke-FrontendNpm "test"
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
        Invoke-FrontendNpm "lint"
        Invoke-FrontendNpm "typecheck"
        Invoke-FrontendNpm "check:i18n-errors"
        Invoke-K8sManifestCheck
        Invoke-K8sReleaseOverlaySmokeCheck
        Invoke-ObservabilityManifestCheck
    }
}
