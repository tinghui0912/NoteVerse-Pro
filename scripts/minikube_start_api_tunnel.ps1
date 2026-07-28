param(
    [string] $Profile = "noteverse-lvm",
    [int] $LocalPort = 18443,
    [int] $RemotePort = 8443
)

$ErrorActionPreference = "Stop"

$keyPath = (minikube ssh-key -p $Profile).Trim()
if (-not (Test-Path $keyPath)) {
    throw "minikube SSH key not found: $keyPath"
}

function Get-QemuSshPort {
    param([string] $ProfileName)

    $process = Get-CimInstance Win32_Process |
        Where-Object {
            $_.Name -eq "qemu-system-x86_64.exe" -and
            $_.CommandLine -match "\\machines\\$([regex]::Escape($ProfileName))\\"
        } |
        Select-Object -First 1

    if (-not $process) {
        throw "No qemu process found for minikube profile $ProfileName."
    }

    $match = [regex]::Match($process.CommandLine, "hostfwd=tcp::(?<port>\d+)-:22")
    if (-not $match.Success) {
        throw "Could not find SSH hostfwd port in qemu command line for profile $ProfileName."
    }

    return [int] $match.Groups["port"].Value
}

$sshPort = Get-QemuSshPort -ProfileName $Profile

$existing = Get-NetTCPConnection -LocalPort $LocalPort -State Listen -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "==> tunnel:already-listening:$LocalPort" -ForegroundColor Cyan
    $existing | Select-Object LocalAddress, LocalPort, State, OwningProcess | Out-Host
    return
}

Write-Host "==> tunnel:start:$Profile $LocalPort -> $RemotePort via ssh port $sshPort" -ForegroundColor Cyan
Start-Process `
    -FilePath "C:\Windows\System32\OpenSSH\ssh.exe" `
    -ArgumentList @(
        "-F", "/dev/null",
        "-o", "BatchMode=yes",
        "-o", "ConnectionAttempts=3",
        "-o", "ConnectTimeout=10",
        "-o", "ControlMaster=no",
        "-o", "ControlPath=none",
        "-o", "LogLevel=quiet",
        "-o", "PasswordAuthentication=no",
        "-o", "ServerAliveInterval=60",
        "-o", "StrictHostKeyChecking=no",
        "-o", "UserKnownHostsFile=/dev/null",
        "docker@127.0.0.1",
        "-o", "IdentitiesOnly=yes",
        "-i", $keyPath,
        "-p", "$sshPort",
        "-NTL", "$($LocalPort):localhost:$RemotePort"
    ) `
    -WindowStyle Hidden

Start-Sleep -Seconds 2
Get-NetTCPConnection -LocalPort $LocalPort -State Listen -ErrorAction Stop |
    Select-Object LocalAddress, LocalPort, State, OwningProcess |
    Out-Host
