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
        "observability",
        "all"
    )]
    [string] $Check = "k8s"
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$BackendQuality = Join-Path $PSScriptRoot "backend_quality.ps1"
$FrontendRoot = Join-Path $RepoRoot "frontend"
$K8sManifestCheck = Join-Path $PSScriptRoot "check_k8s_application_manifests.py"
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
        & $BackendQuality -Check $BackendCheck
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

function Invoke-ObservabilityManifestCheck {
    Invoke-Step "observability:manifests" {
        python $ObservabilityManifestCheck
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
        Invoke-ObservabilityManifestCheck
    }
}
