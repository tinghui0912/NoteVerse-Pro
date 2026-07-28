param(
    [string] $Namespace = "topolvm-system",
    [string] $ValuesFile = "deploy/platform/storage/topolvm/minikube.values.yaml",
    [string] $StorageClassName = "noteverse-local-lvm",
    [switch] $SetDefault
)

$ErrorActionPreference = "Stop"

function Invoke-Checked {
    param(
        [string] $Name,
        [scriptblock] $Command
    )

    Write-Host "==> $Name" -ForegroundColor Cyan
    & $Command
}

Invoke-Checked "prerequisite:kubectl" {
    kubectl version --client | Out-Host
}

Invoke-Checked "prerequisite:helm" {
    helm version --short | Out-Host
}

Invoke-Checked "namespace" {
    kubectl create namespace $Namespace --dry-run=client -o yaml | kubectl apply -f -
}

Invoke-Checked "helm:repo" {
    helm repo add topolvm https://topolvm.github.io/topolvm | Out-Host
    helm repo update topolvm | Out-Host
}

Invoke-Checked "helm:topolvm" {
    & helm upgrade --install topolvm topolvm/topolvm `
        --namespace $Namespace `
        -f $ValuesFile `
        --wait `
        --timeout 10m
    if ($LASTEXITCODE -ne 0) {
        throw "TopoLVM Helm install failed."
    }
}

Invoke-Checked "storageclass:wait" {
    kubectl get storageclass $StorageClassName | Out-Host
}

if ($SetDefault) {
    Invoke-Checked "storageclass:default" {
        $classes = kubectl get storageclass -o jsonpath="{range .items[*]}{.metadata.name}{'\n'}{end}"
        foreach ($class in $classes -split "`n") {
            if (-not $class) {
                continue
            }
            kubectl annotate storageclass $class storageclass.kubernetes.io/is-default-class- --overwrite | Out-Host
        }
        kubectl annotate storageclass $StorageClassName storageclass.kubernetes.io/is-default-class=true --overwrite | Out-Host
    }
}

Invoke-Checked "storageclass:list" {
    kubectl get storageclass | Out-Host
}
