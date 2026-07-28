param(
    [string] $AppNamespace = "noteverse-staging",
    [string] $RenderedOverlay = "build/k8s-release/minikube",
    [string] $BackendSecretEnvFile = "",
    [string] $DockerConfigPath = (Join-Path $env:USERPROFILE ".docker\config.json"),
    [string] $RegistryServer = "ghcr.io",
    [string] $RegistryUsername = "",
    [string] $RegistryTokenEnvName = "GHCR_TOKEN",
    [switch] $CreateRegistrySecretFromDockerConfig,
    [switch] $CreateRegistrySecretFromToken,
    [switch] $SkipBackendSecret,
    [switch] $SkipRegistrySecret,
    [switch] $SkipWorkerWait,
    [switch] $SkipModelCacheWait,
    [switch] $ScaleWorkerToZero,
    [switch] $Apply,
    [switch] $Wait,
    [int] $WaitTimeoutSeconds = 1200
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
    "RESEND_API_KEY"
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

function Assert-DockerConfigCanBeUsedByKubernetes {
    param(
        [string] $Path,
        [string] $Server
    )

    $config = Get-Content -Raw $Path | ConvertFrom-Json
    $auths = $config.auths
    $serverAuth = $null
    if ($auths) {
        $serverAuth = $auths.PSObject.Properties[$Server]
    }

    if ($null -eq $serverAuth -or [string]::IsNullOrWhiteSpace($serverAuth.Value.auth)) {
        $usesCredentialStore = $config.PSObject.Properties.Name -contains "credsStore" -or `
            $config.PSObject.Properties.Name -contains "credHelpers"
        if ($usesCredentialStore) {
            throw "Docker config uses a local credential store and does not contain a portable auth token for $Server. Kubernetes cannot read Docker Desktop credential stores. Use -CreateRegistrySecretFromToken with $RegistryTokenEnvName."
        }
        throw "Docker config does not contain auth for $Server. Use -CreateRegistrySecretFromToken with $RegistryTokenEnvName."
    }
}

function Write-RegistryDockerConfig {
    param(
        [string] $Server,
        [string] $Username,
        [string] $Token
    )

    if ([string]::IsNullOrWhiteSpace($Username)) {
        throw "Registry username is required when using -CreateRegistrySecretFromToken."
    }
    if ([string]::IsNullOrWhiteSpace($Token)) {
        throw "Registry token is required."
    }

    $auth = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("${Username}:${Token}"))
    $config = @{
        auths = @{
            $Server = @{
                username = $Username
                password = $Token
                auth = $auth
            }
        }
    } | ConvertTo-Json -Depth 5

    $tempFile = [System.IO.Path]::GetTempFileName()
    $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($tempFile, $config, $utf8NoBom)

    try {
        Get-Content -Raw $tempFile | ConvertFrom-Json | Out-Null
    } catch {
        [System.IO.File]::Delete($tempFile)
        throw "Generated registry Docker config is not valid JSON."
    }

    return $tempFile
}

Test-CommandAvailable "kubectl"
Test-CommandAvailable "python"

Invoke-Checked "namespace:application" {
    kubectl create namespace $AppNamespace --dry-run=client -o yaml | kubectl apply -f -
}

if (-not $SkipRegistrySecret) {
    if ($CreateRegistrySecretFromToken) {
        $registryToken = [Environment]::GetEnvironmentVariable($RegistryTokenEnvName)
        if ([string]::IsNullOrWhiteSpace($registryToken)) {
            throw "$RegistryTokenEnvName is required when using -CreateRegistrySecretFromToken."
        }
        $tempDockerConfig = Write-RegistryDockerConfig `
            -Server $RegistryServer `
            -Username $RegistryUsername `
            -Token $registryToken
        try {
            Invoke-Checked "secret:registry-pull-token" {
                kubectl -n $AppNamespace create secret generic noteverse-registry-credentials `
                    --type=kubernetes.io/dockerconfigjson `
                    --from-file=.dockerconfigjson=$tempDockerConfig `
                    --dry-run=client -o yaml | kubectl apply -f -
            }
        } finally {
            [System.IO.File]::Delete($tempDockerConfig)
        }
    } elseif ($CreateRegistrySecretFromDockerConfig) {
        if (-not (Test-Path $DockerConfigPath)) {
            throw "Docker config file does not exist: $DockerConfigPath"
        }
        Assert-DockerConfigCanBeUsedByKubernetes -Path $DockerConfigPath -Server $RegistryServer

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

    if ($ScaleWorkerToZero) {
        Invoke-Checked "scale:backend-worker-zero" {
            kubectl -n $AppNamespace scale deployment/noteverse-backend-worker --replicas=0
        }
    }

    if ($Wait) {
        Invoke-Checked "job:migration" {
            kubectl -n $AppNamespace wait --for=condition=complete job/noteverse-db-migrate --timeout="$($WaitTimeoutSeconds)s"
        }
        Invoke-Checked "rollout:backend-api" {
            kubectl -n $AppNamespace rollout status deployment/noteverse-backend-api --timeout="$($WaitTimeoutSeconds)s"
        }
        Invoke-Checked "rollout:backend-practice" {
            kubectl -n $AppNamespace rollout status deployment/noteverse-backend-practice --timeout="$($WaitTimeoutSeconds)s"
        }
        Invoke-Checked "rollout:backend-beat" {
            kubectl -n $AppNamespace rollout status deployment/noteverse-backend-beat --timeout="$($WaitTimeoutSeconds)s"
        }
        if (-not $SkipWorkerWait -and -not $ScaleWorkerToZero) {
            Invoke-Checked "rollout:backend-worker" {
                kubectl -n $AppNamespace rollout status deployment/noteverse-backend-worker --timeout="$($WaitTimeoutSeconds)s"
            }
        } else {
            Write-Host "==> rollout:backend-worker skipped"
        }
        Invoke-Checked "rollout:frontend" {
            kubectl -n $AppNamespace rollout status deployment/noteverse-frontend --timeout="$($WaitTimeoutSeconds)s"
        }
        if (-not $SkipModelCacheWait) {
            Invoke-Checked "rollout:model-cache-agent" {
                kubectl -n $AppNamespace rollout status ds/noteverse-model-cache-agent --timeout=7200s
            }
        } else {
            Write-Host "==> rollout:model-cache-agent skipped"
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
