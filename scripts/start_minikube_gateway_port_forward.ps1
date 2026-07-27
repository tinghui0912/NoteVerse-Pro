param(
    [string]$Namespace = "envoy-gateway-system",
    [string]$Service = "envoy-noteverse-staging-noteverse-dae78ee9",
    [int]$LocalPort = 443,
    [int]$ServicePort = 443
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$buildDir = Join-Path $repoRoot "build"
New-Item -ItemType Directory -Force -Path $buildDir | Out-Null

$existing = Get-NetTCPConnection -LocalPort $LocalPort -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($existing) {
    Stop-Process -Id $existing.OwningProcess -Force
}

$log = Join-Path $buildDir "minikube-gateway-port-forward.log"
$err = Join-Path $buildDir "minikube-gateway-port-forward.err.log"
$command = "kubectl -n $Namespace port-forward svc/$Service ${LocalPort}:$ServicePort"

Start-Process `
    -WindowStyle Hidden `
    -FilePath powershell.exe `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $command) `
    -RedirectStandardOutput $log `
    -RedirectStandardError $err

Start-Sleep -Seconds 3
Get-NetTCPConnection -LocalPort $LocalPort -State Listen -ErrorAction Stop | Select-Object LocalAddress, LocalPort, State, OwningProcess
