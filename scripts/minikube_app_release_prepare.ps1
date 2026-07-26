param(
    [string] $AppNamespace = "noteverse-staging",
    [string] $RenderedOverlay = "build/k8s-release/minikube",
    [string] $BackendSecretEnvFile = "",
    [string] $DockerConfigPath = (Join-Path $env:USERPROFILE ".docker\config.json"),
    [switch] $CreateRegistrySecretFromDockerConfig,
    [switch] $SkipBackendSecret,
    [switch] $SkipRegistrySecret,
    [switch] $Apply,
    [switch] $Wait
)

$ErrorActionPreference = "Stop"

$RequiredBackendSecretKeys = @(
    "SECRET_KEY",
    "DATABASE_URL",
    "SYNC_DATABASE_URL",
    "REDIS_URL",
    "CELERY_BROKER_URL",
    "CELERY_RESULT_BACKEND",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "RESEND_API_KEY",
    "HF_TOKEN"
)

function Invoke-Checked {
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

function Test-CommandAvailable {
    param([string] $Name)

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "$Name is required but was not found on PATH."
    }
}

function Get-EnvFileKeys {
    param([string] $Path)

    $keys = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    Get-Content $Path | ForEach-Object {
        $line = $_.Trim()
        if ($line.Length -eq 0 -or $line.StartsWith("#")) {
            return
        }

        $index = $line.IndexOf("=")
        if ($index -le 0) {
            return
        }

        [void] $keys.Add($line.Substring(0, $index).Trim())
    }
    return $keys
}

function Assert-EnvFileContainsRequiredKeys {
    param([string] $Path)

    if (-not (Test-Path $Path)) {
        throw "Backend Secret env file does not exist: $Path"
    }

    $keys = Get-EnvFileKeys $Path
    $missing = $RequiredBackendSecretKeys | Where-Object { -not $keys.Contains($_) }
    if ($missing.Count -gt 0) {
        throw "Backend Secret env file is missing required keys: $($missing -join ', ')"
    }
}

function Assert-ClusterSecretContainsRequiredKeys {
    param(
        [string] $Namespace,
        [string] $Name,
        [string[]] $RequiredKeys
    )

    $json = kubectl -n $Namespace get secret $Name -o json 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "Secret/$Name does not exist in namespace $Namespace. Pass -BackendSecretEnvFile or create it before running this script."
    }

    $secret = $json | ConvertFrom-Json
    $data = $secret.data
    $missing = $RequiredKeys | Where-Object { -not ($data.PSObject.Properties.Name -contains $_) }
    if ($missing.Count -gt 0) {
        throw "Secret/$Name is missing required keys: $($missing -join ', ')"
    }
}

Test-CommandAvailable "kubectl"
Test-CommandAvailable "python"

Invoke-Checked "namespace:application" {
    kubectl create namespace $AppNamespace --dry-run=client -o yaml | kubectl apply -f -
}

if (-not $SkipRegistrySecret) {
    if ($CreateRegistrySecretFromDockerConfig) {
        if (-not (Test-Path $DockerConfigPath)) {
            throw "Docker config file does not exist: $DockerConfigPath"
        }

        Invoke-Checked "secret:registry-pull" {
            kubectl -n $AppNamespace create secret generic noteverse-registry-credentials `
                --type=kubernetes.io/dockerconfigjson `
                --from-file=.dockerconfigjson=$DockerConfigPath `
                --dry-run=client -o yaml | kubectl apply -f -
        }
    } else {
        Invoke-Checked "secret:registry-pull-exists" {
            kubectl -n $AppNamespace get secret noteverse-registry-credentials
        }
    }
}

if (-not $SkipBackendSecret) {
    if (-not [string]::IsNullOrWhiteSpace($BackendSecretEnvFile)) {
        Assert-EnvFileContainsRequiredKeys $BackendSecretEnvFile
        Invoke-Checked "secret:backend" {
            kubectl -n $AppNamespace create secret generic noteverse-backend-secret `
                --from-env-file=$BackendSecretEnvFile `
                --dry-run=client -o yaml | kubectl apply -f -
        }
    } else {
        Invoke-Checked "secret:backend-exists" {
            Assert-ClusterSecretContainsRequiredKeys $AppNamespace "noteverse-backend-secret" $RequiredBackendSecretKeys
        }
    }
}

Invoke-Checked "overlay:strict-validation" {
    python scripts/check_k8s_application_manifests.py $RenderedOverlay --strict
}

Invoke-Checked "overlay:kustomize-render" {
    kubectl kustomize $RenderedOverlay > $null
}

if ($Apply) {
    Invoke-Checked "migration-job:replace" {
        kubectl -n $AppNamespace delete job noteverse-db-migrate --ignore-not-found --wait=true
    }

    Invoke-Checked "overlay:apply" {
        kubectl apply -k $RenderedOverlay
    }

    if ($Wait) {
        Invoke-Checked "job:migration" {
            kubectl -n $AppNamespace wait --for=condition=complete job/noteverse-db-migrate --timeout=300s
        }
        Invoke-Checked "rollout:backend-api" {
            kubectl -n $AppNamespace rollout status deployment/noteverse-backend-api --timeout=300s
        }
        Invoke-Checked "rollout:backend-practice" {
            kubectl -n $AppNamespace rollout status deployment/noteverse-backend-practice --timeout=300s
        }
        Invoke-Checked "rollout:backend-beat" {
            kubectl -n $AppNamespace rollout status deployment/noteverse-backend-beat --timeout=300s
        }
        Invoke-Checked "rollout:backend-worker" {
            kubectl -n $AppNamespace rollout status deployment/noteverse-backend-worker --timeout=300s
        }
        Invoke-Checked "rollout:frontend" {
            kubectl -n $AppNamespace rollout status deployment/noteverse-frontend --timeout=300s
        }
        Invoke-Checked "rollout:model-cache-agent" {
            kubectl -n $AppNamespace rollout status ds/noteverse-model-cache-agent --timeout=7200s
        }
        Invoke-Checked "gateway:status" {
            kubectl -n $AppNamespace get certificate,gateway,httproute
        }
    }
}

Write-Host ""
Write-Host "Application release preparation completed."
Write-Host "Overlay: $RenderedOverlay"
Write-Host "Namespace: $AppNamespace"
