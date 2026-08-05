param(
    [string] $ApplicationNamespace = "noteverse-staging",
    [string] $GatewayNamespace = "envoy-gateway-system",
    [string] $Image = "",
    [int] $TimeoutSeconds = 90
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Image)) {
    $Image = (kubectl -n $ApplicationNamespace get deployment noteverse-backend-api `
        -o jsonpath='{.spec.template.spec.containers[0].image}').Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($Image)) {
        throw "Unable to resolve the backend API image. Pass -Image explicitly or deploy noteverse-backend-api first."
    }
}

function Invoke-Checked {
    param([string] $Name, [scriptblock] $Command)

    Write-Host "==> $Name" -ForegroundColor Cyan
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Name failed."
    }
}

function Invoke-SmokePod {
    param(
        [string] $Name,
        [string] $Namespace,
        [string] $Labels,
        [string] $Script
    )

    $manifest = @"
apiVersion: v1
kind: Pod
metadata:
  name: $Name
  namespace: $Namespace
  labels:
$Labels
spec:
  restartPolicy: Never
  containers:
    - name: probe
      image: $Image
      imagePullPolicy: IfNotPresent
      command: ["python", "-c"]
      args:
        - |
$(($Script -split "`n" | ForEach-Object { "          $_" }) -join "`n")
"@
    $manifest | kubectl apply -f - | Out-Host
    kubectl -n $Namespace wait --for=jsonpath='{.status.phase}'=Succeeded pod/$Name --timeout="$($TimeoutSeconds)s" | Out-Host
    kubectl -n $Namespace logs pod/$Name | Out-Host
}

$suffix = [System.Guid]::NewGuid().ToString("N").Substring(0, 8)
$allowedControl = "network-policy-control-allowed-$suffix"
$deniedControl = "network-policy-control-denied-$suffix"
$allowedAdmin = "network-policy-admin-allowed-$suffix"
$deniedAdmin = "network-policy-admin-denied-$suffix"

$connect = @"
import socket
host = "{0}"
port = {1}
expected = {2}
try:
    with socket.create_connection((host, port), timeout=5):
        connected = True
except OSError:
    connected = False
if connected != expected:
    raise SystemExit("expected connected=%s, got %s" % (expected, connected))
print("connected=%s" % connected)
"@

try {
    Invoke-Checked "policy:control-plane-allowed" {
        Invoke-SmokePod -Name $allowedControl -Namespace $ApplicationNamespace `
            -Labels "    app.kubernetes.io/name: noteverse`n    app.kubernetes.io/part-of: noteverse`n    app.kubernetes.io/component: platform-admin" `
            -Script ($connect -f "noteverse-control-plane", 8000, "True")
    }
    Invoke-Checked "policy:control-plane-denied" {
        Invoke-SmokePod -Name $deniedControl -Namespace $ApplicationNamespace `
            -Labels "    app.kubernetes.io/name: noteverse`n    app.kubernetes.io/component: network-policy-smoke" `
            -Script ($connect -f "noteverse-control-plane", 8000, "False")
    }
    Invoke-Checked "policy:platform-admin-allowed" {
        Invoke-SmokePod -Name $allowedAdmin -Namespace $GatewayNamespace `
            -Labels "    app.kubernetes.io/name: envoy`n    app.kubernetes.io/component: proxy`n    app.kubernetes.io/managed-by: envoy-gateway" `
            -Script ($connect -f "noteverse-platform-admin.noteverse-staging", 3000, "True")
    }
    Invoke-Checked "policy:platform-admin-denied" {
        Invoke-SmokePod -Name $deniedAdmin -Namespace $ApplicationNamespace `
            -Labels "    app.kubernetes.io/name: noteverse`n    app.kubernetes.io/component: network-policy-smoke" `
            -Script ($connect -f "noteverse-platform-admin", 3000, "False")
    }
}
finally {
    foreach ($pod in @(
        @{ Namespace = $ApplicationNamespace; Name = $allowedControl },
        @{ Namespace = $ApplicationNamespace; Name = $deniedControl },
        @{ Namespace = $GatewayNamespace; Name = $allowedAdmin },
        @{ Namespace = $ApplicationNamespace; Name = $deniedAdmin }
    )) {
        kubectl -n $pod.Namespace delete pod $pod.Name --ignore-not-found --wait=false | Out-Host
    }
}
