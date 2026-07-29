param(
    [string]$Namespace = "argocd",
    [string]$SecretName = "noteverse-repo-credentials",
    [string]$RepoUrl = "https://github.com/tinghui0912/NoteVerse-Pro.git",
    [string]$Username = "tinghui0912",
    [string]$TokenEnvName = "GITHUB_REPO_TOKEN"
)

$ErrorActionPreference = "Stop"

$token = [Environment]::GetEnvironmentVariable($TokenEnvName)
if ([string]::IsNullOrWhiteSpace($token)) {
    throw "$TokenEnvName is required. Set it to a fine-scoped GitHub token with read access to $RepoUrl."
}

kubectl get namespace $Namespace *> $null
if ($LASTEXITCODE -ne 0) {
    throw "Namespace '$Namespace' does not exist. Install Argo CD first."
}

$manifest = kubectl -n $Namespace create secret generic $SecretName `
    --from-literal=type=git `
    --from-literal=url=$RepoUrl `
    --from-literal=username=$Username `
    --from-literal=password=$token `
    --dry-run=client `
    -o yaml

$manifest |
    kubectl label -f - argocd.argoproj.io/secret-type=repository --local -o yaml |
    kubectl apply -f -

Write-Host "Argo CD repository credential secret applied: $Namespace/$SecretName"
