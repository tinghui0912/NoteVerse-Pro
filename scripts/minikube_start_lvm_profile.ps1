param(
    [string] $Profile = "noteverse-lvm",
    [int] $Nodes = 1,
    [int] $Cpus = 4,
    [string] $Memory = "8192",
    [string] $DiskSize = "80g",
    [int] $ExtraDisks = 1,
    [int] $ApiLocalPort = 18443,
    [string] $KubernetesVersion = ""
)

$ErrorActionPreference = "Stop"

function Add-QemuPath {
    $knownPaths = @(
        "C:\Program Files\qemu",
        "C:\Program Files (x86)\qemu"
    )

    foreach ($path in $knownPaths) {
        if ((Test-Path (Join-Path $path "qemu-system-x86_64.exe")) -and ($env:Path -notlike "*$path*")) {
            $env:Path = "$path;$env:Path"
        }
    }
}

function Assert-Command {
    param([string] $Name)

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "$Name is required. Install it and make sure it is available on PATH."
    }
}

Add-QemuPath
Assert-Command "minikube"
Assert-Command "kubectl"
Assert-Command "qemu-system-x86_64"
Assert-Command "qemu-img"

$args = @(
    "start",
    "-p", $Profile,
    "--driver=qemu2",
    "--nodes=$Nodes",
    "--cpus=$Cpus",
    "--memory=$Memory",
    "--disk-size=$DiskSize",
    "--extra-disks=$ExtraDisks"
)

if ($KubernetesVersion) {
    $args += "--kubernetes-version=$KubernetesVersion"
}

Write-Host "==> minikube:start:$Profile" -ForegroundColor Cyan
& minikube @args
if ($LASTEXITCODE -ne 0) {
    $qemuProcess = Get-CimInstance Win32_Process |
        Where-Object {
            $_.Name -eq "qemu-system-x86_64.exe" -and
            $_.CommandLine -match "\\machines\\$([regex]::Escape($Profile))\\"
        } |
        Select-Object -First 1

    if (-not $qemuProcess) {
        throw "minikube start failed for profile $Profile."
    }

    Write-Warning "minikube start returned a non-zero exit code, but the qemu VM is running. Continuing with a manual API tunnel."
}

Write-Host "==> api:tunnel" -ForegroundColor Cyan
& (Join-Path $PSScriptRoot "minikube_start_api_tunnel.ps1") `
    -Profile $Profile `
    -LocalPort $ApiLocalPort
if ($LASTEXITCODE -ne 0) {
    throw "Could not start API tunnel for profile $Profile."
}

Write-Host "==> kubeconfig:server" -ForegroundColor Cyan
& kubectl config set-cluster $Profile --server="https://127.0.0.1:$ApiLocalPort" | Out-Host

Write-Host "==> kubectl:context" -ForegroundColor Cyan
& kubectl config use-context $Profile | Out-Host

Write-Host "==> nodes" -ForegroundColor Cyan
& kubectl get nodes -o wide | Out-Host
