param(
    [string] $Profile = "noteverse-lvm",
    [int] $Nodes = 1,
    [int] $Cpus = 4,
    [string] $Memory = "8192",
    [string] $DiskSize = "80g",
    [int] $ExtraDisks = 1,
    [ValidateSet("cilium")]
    [string] $Cni = "cilium",
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

function Enable-QemuCiliumEndpointRoutes {
    param(
        [string] $CniName
    )

    if ($CniName -ne "cilium") {
        return
    }

    Write-Host "==> cilium:qemu2-endpoint-routes" -ForegroundColor Cyan
    & kubectl -n kube-system rollout status daemonset/cilium --timeout=300s | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "Cilium did not become ready."
    }

    $endpointRoutes = & kubectl -n kube-system get configmap cilium-config -o jsonpath='{.data.enable-endpoint-routes}'
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to read the Cilium configuration."
    }

    if ($endpointRoutes -ne "true") {
        & kubectl -n kube-system patch configmap cilium-config --type merge --patch '{"data":{"enable-endpoint-routes":"true"}}' | Out-Host
        if ($LASTEXITCODE -ne 0) {
            throw "Unable to enable Cilium endpoint routes for qemu2."
        }

        & kubectl -n kube-system rollout restart daemonset/cilium | Out-Host
        if ($LASTEXITCODE -ne 0) {
            throw "Unable to restart Cilium after enabling endpoint routes."
        }

        & kubectl -n kube-system rollout status daemonset/cilium --timeout=300s | Out-Host
        if ($LASTEXITCODE -ne 0) {
            throw "Cilium did not become ready after enabling endpoint routes."
        }
    }

    & kubectl -n kube-system rollout restart deployment/coredns | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to restart CoreDNS after configuring Cilium."
    }

    & kubectl -n kube-system rollout status deployment/coredns --timeout=300s | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "CoreDNS did not become ready after configuring Cilium."
    }
}

function Set-QemuNodeDnsResolvers {
    param(
        [string] $MinikubeProfile,
        [string[]] $Resolvers = @("1.1.1.1", "8.8.8.8")
    )

    if ($Resolvers.Count -eq 0 -or ($Resolvers | Where-Object { [string]::IsNullOrWhiteSpace($_) })) {
        throw "Resolvers must contain at least one non-empty DNS server address."
    }

    $nodes = & minikube -p $MinikubeProfile node list
    if ($LASTEXITCODE -ne 0 -or $nodes.Count -eq 0) {
        throw "Unable to list nodes for minikube profile $MinikubeProfile."
    }

    $dns = $Resolvers -join " "
    foreach ($node in $nodes) {
        Write-Host "==> qemu2:dns:$node" -ForegroundColor Cyan
        $command = @"
sudo mkdir -p /etc/systemd/resolved.conf.d && \
printf '[Resolve]\\nDNS=$dns\\nFallbackDNS=1.0.0.1 8.8.4.4\\n' | \
sudo tee /etc/systemd/resolved.conf.d/99-noteverse-qemu-dns.conf >/dev/null && \
sudo systemctl restart systemd-resolved && \
status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --connect-timeout 10 --max-time 30 https://ghcr.io/v2/)" && \
test "$status" = '401' -o "$status" = '405'
"@
        & minikube -p $MinikubeProfile ssh -n $node -- $command
        if ($LASTEXITCODE -ne 0) {
            throw "Unable to configure or verify node-level DNS on $node."
        }
    }
}

Add-QemuPath
Assert-Command "minikube"
Assert-Command "kubectl"
Assert-Command "qemu-system-x86_64"
Assert-Command "qemu-img"

$qemuProcess = Get-CimInstance Win32_Process |
    Where-Object {
        $_.Name -eq "qemu-system-x86_64.exe" -and
        $_.CommandLine -match "\\machines\\$([regex]::Escape($Profile))\\"
    } |
    Select-Object -First 1

if ($qemuProcess) {
    Write-Host "==> minikube:reuse-running-profile:$Profile" -ForegroundColor Cyan
    & minikube -p $Profile ssh -- "true"
    if ($LASTEXITCODE -ne 0) {
        throw "The qemu VM for profile $Profile exists but is not reachable over SSH. Stop or delete the broken profile before retrying."
    }
}
else {
    $args = @(
        "start",
        "-p", $Profile,
        "--driver=qemu2",
        "--nodes=$Nodes",
        "--cpus=$Cpus",
        "--memory=$Memory",
        "--disk-size=$DiskSize",
        "--extra-disks=$ExtraDisks",
        "--cni=$Cni"
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

Set-QemuNodeDnsResolvers -MinikubeProfile $Profile
Enable-QemuCiliumEndpointRoutes -CniName $Cni
