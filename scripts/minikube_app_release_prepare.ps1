param(
    [string] $AppNamespace = "noteverse-staging",
    [string] $RenderedOverlay = "build/k8s-release/minikube",
    [string] $BackendSecretEnvFile = "",
    [string] $DockerConfigPath = (Join-Path $env:USERPROFILE ".docker\config.json"),
    [string] $RegistryServer = "ghcr.io",
    [string] $RegistryUsername = "",
    [string] $RegistryTokenEnvName = "GHCR_TOKEN",
    [switch] $CreateRegistrySecretFromDockerConfig,
    [switch] $CreateRegistrySecretFromDockerCredentialStore,
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
    "SCHEDULER_LOCK_DATABASE_URL",
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

function Wait-ForActiveDeployment {
    param(
        [Parameter(Mandatory = $true)]
        [string] $DeploymentName,
        [Parameter(Mandatory = $true)]
        [int] $TimeoutSeconds
    )

    $replicas = kubectl -n $AppNamespace get deployment $DeploymentName -o jsonpath='{.spec.replicas}'
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to read desired replicas for deployment/$DeploymentName."
    }
    if ([int]$replicas -eq 0) {
        Write-Host "==> rollout:$DeploymentName skipped (zero desired replicas)"
        return
    }

    Invoke-Checked "rollout:$DeploymentName" {
        kubectl -n $AppNamespace rollout status "deployment/$DeploymentName" --timeout="$($TimeoutSeconds)s"
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

function New-FilteredEnvFile {
    param(
        [string] $Path,
        [string[]] $AllowedKeys
    )

    $allowed = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::Ordinal
    )
    $AllowedKeys | ForEach-Object { [void] $allowed.Add($_) }

    $tempFile = [System.IO.Path]::GetTempFileName()
    $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
    $lines = [System.Collections.Generic.List[string]]::new()

    Get-Content $Path | ForEach-Object {
        $line = $_.Trim()
        if ($line.Length -eq 0 -or $line.StartsWith("#")) {
            return
        }

        $index = $line.IndexOf("=")
        if ($index -le 0) {
            return
        }

        $key = $line.Substring(0, $index).Trim()
        if ($allowed.Contains($key)) {
            $lines.Add($_)
        }
    }

    [System.IO.File]::WriteAllLines($tempFile, $lines, $utf8NoBom)
    return $tempFile
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

function Get-DockerCredentialStoreCredential {
    param(
        [string] $Path,
        [string] $Server
    )

    if (-not (Test-Path $Path)) {
        throw "Docker config file does not exist: $Path"
    }

    $config = Get-Content -Raw $Path | ConvertFrom-Json
    $store = [string] $config.credsStore
    if ([string]::IsNullOrWhiteSpace($store)) {
        throw "Docker config does not define credsStore. Use -CreateRegistrySecretFromDockerConfig or -CreateRegistrySecretFromToken."
    }

    $helperName = "docker-credential-$store"
    $helper = Get-Command $helperName -ErrorAction SilentlyContinue
    if ($null -eq $helper) {
        throw "Docker credential helper '$helperName' was not found on PATH. Use -CreateRegistrySecretFromToken."
    }

    $credentialJson = $Server | & $helper.Source get
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($credentialJson)) {
        throw "Docker credential helper could not read credentials for $Server. Log in with Docker Desktop or use -CreateRegistrySecretFromToken."
    }

    try {
        $credential = $credentialJson | ConvertFrom-Json
    } catch {
        throw "Docker credential helper returned invalid JSON for $Server."
    }

    if ([string]::IsNullOrWhiteSpace($credential.Username) -or [string]::IsNullOrWhiteSpace($credential.Secret)) {
        throw "Docker credential helper did not return a usable username and token for $Server."
    }

    return $credential
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
    } elseif ($CreateRegistrySecretFromDockerCredentialStore) {
        $credential = Get-DockerCredentialStoreCredential -Path $DockerConfigPath -Server $RegistryServer
        $tempDockerConfig = Write-RegistryDockerConfig `
            -Server $RegistryServer `
            -Username $credential.Username `
            -Token $credential.Secret
        try {
            Invoke-Checked "secret:registry-pull-credential-store" {
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
        $filteredBackendSecretEnvFile = New-FilteredEnvFile `
            -Path $BackendSecretEnvFile `
            -AllowedKeys $RequiredBackendSecretKeys
        try {
            Invoke-Checked "secret:backend" {
                kubectl -n $AppNamespace create secret generic noteverse-backend-secret `
                    --from-env-file=$filteredBackendSecretEnvFile `
                    --dry-run=client -o yaml | kubectl apply -f -
            }
        } finally {
            [System.IO.File]::Delete($filteredBackendSecretEnvFile)
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
    $phaseDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("noteverse-release-phases-" + [System.Guid]::NewGuid().ToString("N"))
    try {
        Invoke-Checked "overlay:release-phases" {
            python scripts/render_k8s_release_phases.py $RenderedOverlay --output-dir $phaseDirectory
        }

        Invoke-Checked "overlay:apply-bootstrap" {
            kubectl apply -f (Join-Path $phaseDirectory "00-bootstrap.yaml")
        }

    Invoke-Checked "migration-job:replace" {
        kubectl -n $AppNamespace delete job noteverse-db-migrate --ignore-not-found --wait=true
    }

        Invoke-Checked "migration-job:apply" {
            kubectl apply -f (Join-Path $phaseDirectory "10-migration.yaml")
        }

        if ($Wait) {
            Invoke-Checked "job:migration" {
                kubectl -n $AppNamespace wait --for=condition=complete job/noteverse-db-migrate --timeout="$($WaitTimeoutSeconds)s"
            }
        }

        Invoke-Checked "overlay:apply-workloads" {
            kubectl apply -f (Join-Path $phaseDirectory "20-workloads.yaml")
        }

        if ($ScaleWorkerToZero) {
            Invoke-Checked "scale:backend-worker-zero" {
                kubectl -n $AppNamespace scale deployment/noteverse-backend-worker --replicas=0
            }
        }

        if ($Wait) {
            Wait-ForActiveDeployment -DeploymentName "noteverse-backend-api" -TimeoutSeconds $WaitTimeoutSeconds
            Wait-ForActiveDeployment -DeploymentName "noteverse-backend-practice" -TimeoutSeconds $WaitTimeoutSeconds
            Wait-ForActiveDeployment -DeploymentName "noteverse-backend-beat" -TimeoutSeconds $WaitTimeoutSeconds
            if (-not $SkipWorkerWait -and -not $ScaleWorkerToZero) {
                Invoke-Checked "rollout:backend-worker" {
                    kubectl -n $AppNamespace rollout status deployment/noteverse-backend-worker --timeout="$($WaitTimeoutSeconds)s"
                }
            } else {
                Write-Host "==> rollout:backend-worker skipped"
            }
            Wait-ForActiveDeployment -DeploymentName "noteverse-customer-web" -TimeoutSeconds $WaitTimeoutSeconds
            Wait-ForActiveDeployment -DeploymentName "noteverse-control-plane" -TimeoutSeconds $WaitTimeoutSeconds
            Wait-ForActiveDeployment -DeploymentName "noteverse-platform-admin" -TimeoutSeconds $WaitTimeoutSeconds
            Wait-ForActiveDeployment -DeploymentName "noteverse-observability-exporter" -TimeoutSeconds $WaitTimeoutSeconds
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
    } finally {
        if (Test-Path $phaseDirectory) {
            Remove-Item -LiteralPath $phaseDirectory -Recurse -Force
        }
    }
}

Write-Host ""
Write-Host "Application release preparation completed."
Write-Host "Overlay: $RenderedOverlay"
Write-Host "Namespace: $AppNamespace"
