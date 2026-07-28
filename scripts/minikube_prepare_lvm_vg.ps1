param(
    [string] $Profile = "noteverse-lvm",
    [string] $VolumeGroup = "noteverse-local-vg",
    [switch] $WipeExtraDisk
)

$ErrorActionPreference = "Stop"

if (-not $WipeExtraDisk) {
    throw "Refusing to initialize LVM without -WipeExtraDisk. This command wipes the detected extra disk on each minikube node."
}

function Invoke-Checked {
    param(
        [string] $Name,
        [scriptblock] $Command
    )

    Write-Host "==> $Name" -ForegroundColor Cyan
    & $Command
}

Invoke-Checked "kubectl:context" {
    kubectl config use-context $Profile | Out-Host
}

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

$nodesText = kubectl get nodes -o jsonpath="{range .items[*]}{.metadata.name}{'\n'}{end}"
$nodes = $nodesText -split "`n" | Where-Object { $_ }

if (-not $nodes) {
    throw "No Kubernetes nodes found in context $Profile."
}

$nodeScriptTemplate = @'
set -eu

VG_NAME="__VG_NAME__"

if ! command -v pvcreate >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update
    sudo apt-get install -y lvm2
  else
    echo "lvm2 is required but apt-get is not available" >&2
    exit 1
  fi
fi

if sudo vgs "${VG_NAME}" >/dev/null 2>&1; then
  sudo vgs "${VG_NAME}"
  exit 0
fi

candidate=""
for disk in $(lsblk -dpno NAME,TYPE,MOUNTPOINTS | awk '$2 == "disk" && $3 == "" {print $1}'); do
  line_count="$(lsblk -nr "$disk" | wc -l | tr -d " ")"
  if [ "$line_count" = "1" ]; then
    candidate="$disk"
    break
  fi
done

if [ -z "$candidate" ]; then
  echo "No empty extra disk found. Create the profile with --extra-disks and rerun." >&2
  lsblk
  exit 1
fi

echo "Initializing ${candidate} as ${VG_NAME}"
if command -v wipefs >/dev/null 2>&1; then
  sudo wipefs -a "$candidate"
fi
sudo pvcreate -ff -y "$candidate"
sudo vgcreate "$VG_NAME" "$candidate"
sudo vgs "$VG_NAME"
'@

foreach ($node in $nodes) {
    Invoke-Checked "lvm:$node" {
        $tempScript = New-TemporaryFile
        try {
            $escapedVolumeGroup = $VolumeGroup.Replace('\', '\\').Replace('"', '\"')
            $nodeScript = $nodeScriptTemplate.Replace("__VG_NAME__", $escapedVolumeGroup)
            [System.IO.File]::WriteAllText(
                $tempScript,
                ($nodeScript -replace "`r`n", "`n"),
                [System.Text.UTF8Encoding]::new($false)
            )
            Get-Content -Raw $tempScript |
                & "C:\Windows\System32\OpenSSH\ssh.exe" `
                    -F /dev/null `
                    -o BatchMode=yes `
                    -o ConnectionAttempts=3 `
                    -o ConnectTimeout=10 `
                    -o ControlMaster=no `
                    -o ControlPath=none `
                    -o LogLevel=quiet `
                    -o PasswordAuthentication=no `
                    -o StrictHostKeyChecking=no `
                    -o UserKnownHostsFile=/dev/null `
                    docker@127.0.0.1 `
                    -o IdentitiesOnly=yes `
                    -i $keyPath `
                    -p $sshPort `
                    "sudo bash -s" |
                Out-Host
            if ($LASTEXITCODE -ne 0) {
                throw "LVM initialization failed on $node."
            }
        }
        finally {
            Remove-Item -LiteralPath $tempScript -Force -ErrorAction SilentlyContinue
        }
    }
}

Invoke-Checked "node:list" {
    kubectl get nodes -o wide | Out-Host
}
