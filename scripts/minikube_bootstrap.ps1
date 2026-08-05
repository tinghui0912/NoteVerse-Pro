param(
    [string] $AppNamespace = "noteverse-staging",
    [string] $ObservabilityNamespace = "observability",
    [string] $ApiDeployment = "noteverse-backend-api",
    [string] $Profile = $(if ($env:MINIKUBE_PROFILE) { $env:MINIKUBE_PROFILE } else { "noteverse-lvm" }),
    [switch] $ApplyDnsFix,
    [switch] $ValidateTracing
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
Invoke-Checked "cluster:nodes" {
    $currentContext = (kubectl config current-context).Trim()
    if ($currentContext -ne $Profile) {
        throw "Current kubeconfig context is '$currentContext'; expected '$Profile'."
    }
    kubectl get nodes -o wide
}

Invoke-Checked "cluster:api-ready" {
    kubectl get --raw='/readyz' | Out-Null
}

if ($ApplyDnsFix) {
    Invoke-Checked "coredns:scale-to-two-replicas" {
        kubectl -n kube-system scale deployment coredns --replicas=2
    }

    Invoke-Checked "coredns:rollout" {
        kubectl -n kube-system rollout status deployment/coredns --timeout=180s
    }

    Invoke-Checked "kube-dns:use-cluster-endpoints" {
        kubectl -n kube-system patch svc kube-dns --type='json' -p '[{"op":"remove","path":"/spec/internalTrafficPolicy"}]' 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Host "kube-dns internalTrafficPolicy was already unset."
            $global:LASTEXITCODE = 0
        }
    }
}

Invoke-Checked "coredns:pods" {
    kubectl -n kube-system get pods -l k8s-app=kube-dns -o wide
}

Invoke-Checked "kube-dns:service-policy" {
    kubectl -n kube-system get svc kube-dns -o jsonpath="{.spec.internalTrafficPolicy}"
    Write-Host ""
}

Invoke-Checked "application:pods" {
    kubectl -n $AppNamespace get pods -o wide
}

Invoke-Checked "observability:pods" {
    kubectl -n $ObservabilityNamespace get pods -o wide
}

if ($ValidateTracing) {
    $collectorHost = "otel-collector-opentelemetry-collector.$ObservabilityNamespace.svc.cluster.local"
    $tempoHost = "tempo.$ObservabilityNamespace.svc.cluster.local"
    $pythonScript = @"
import socket

targets = [
    ("kubernetes", "kubernetes.default.svc.cluster.local", 443),
    ("otel_collector", "$collectorHost", 4317),
    ("tempo", "$tempoHost", 4317),
]

for label, host, port in targets:
    ip = socket.gethostbyname(host)
    with socket.create_connection((host, port), timeout=5):
        print(f"OK {label}: {host} -> {ip}:{port}")
"@
    $encodedPythonScript = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($pythonScript))
    $pythonCommand = "import base64; exec(base64.b64decode('$encodedPythonScript').decode())"

    Invoke-Checked "tracing:service-connectivity-from-api" {
        kubectl -n $AppNamespace exec "deploy/$ApiDeployment" -- python -c $pythonCommand
    }

    Invoke-Checked "tracing:generate-api-spans" {
        for ($i = 0; $i -lt 5; $i++) {
            kubectl -n $AppNamespace exec "deploy/$ApiDeployment" -- python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/health/ready', timeout=5).status)"
        }
    }

    Write-Host "Tracing smoke generated API spans. To inspect them, port-forward Tempo and query service.name=noteverse-backend-api:"
    Write-Host "kubectl -n $ObservabilityNamespace port-forward svc/tempo 13200:3200"
    Write-Host "Invoke-RestMethod -Uri 'http://127.0.0.1:13200/api/search?tags=service.name%3Dnoteverse-backend-api&limit=20'"
}
