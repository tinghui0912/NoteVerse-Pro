param(
    [string] $AppNamespace = "noteverse-staging",
    [string] $AppHost = "staging.johnabc.ccwu.cc",
    [string] $ApiBase = "https://staging.johnabc.ccwu.cc/api/v1",
    [string] $PortForwardService = "",
    [switch] $StartGatewayPortForward,
    [switch] $RunStorageSmoke,
    [switch] $EnsureSmokeUser
)

$ErrorActionPreference = "Stop"

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

Test-CommandAvailable "kubectl"
Test-CommandAvailable "curl.exe"
Test-CommandAvailable "python"

if ($StartGatewayPortForward) {
    Invoke-Checked "gateway:port-forward" {
        if ([string]::IsNullOrWhiteSpace($PortForwardService)) {
            .\scripts\start_minikube_gateway_port_forward.ps1
        } else {
            .\scripts\start_minikube_gateway_port_forward.ps1 -Service $PortForwardService
        }
    }
}

Invoke-Checked "cluster:workloads" {
    kubectl -n $AppNamespace get deploy,ds,job,certificate,gateway,httproute
}

Invoke-Checked "gateway:same-origin-api-route" {
    $nullTarget = if ($IsWindows) { "NUL" } else { "/dev/null" }
    $statusCode = curl.exe `
        --silent `
        --show-error `
        --output $nullTarget `
        --write-out "%{http_code}" `
        "https://$AppHost/api/v1/me/profile"
    if ($statusCode -ne "401") {
        throw "Expected same-origin API route to return 401 for anonymous profile request, got $statusCode."
    }
    Write-Host "anonymous profile request returned expected 401"
}

Invoke-Checked "gateway:frontend" {
    curl.exe --fail --silent --show-error --head "https://$AppHost/zh/upload" | Out-Host
}

if ($RunStorageSmoke) {
    $storageSmokeArgs = @(
        "scripts/k8s_smoke_storage.py",
        "--api-base", $ApiBase,
        "--namespace", $AppNamespace
    )
    if ($EnsureSmokeUser) {
        $storageSmokeArgs += "--ensure-user"
    }
    Invoke-Checked "smoke:storage" {
        python @storageSmokeArgs
    }
}

Write-Host ""
Write-Host "Minikube smoke test completed."
