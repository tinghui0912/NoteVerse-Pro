param(
    [string] $StorageClassName = "noteverse-local-lvm",
    [string] $Namespace = "default",
    [string] $Name = "openebs-lvm-smoke",
    [string] $Size = "1Gi",
    [int] $TimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"

function Invoke-Checked {
    param(
        [string] $StepName,
        [scriptblock] $Command
    )

    Write-Host "==> $StepName" -ForegroundColor Cyan
    & $Command
}

$manifest = @"
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: $Name
  namespace: $Namespace
spec:
  storageClassName: $StorageClassName
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: $Size
---
apiVersion: v1
kind: Pod
metadata:
  name: $Name
  namespace: $Namespace
spec:
  restartPolicy: Never
  containers:
    - name: smoke
      image: busybox:1.36
      command: ["sh", "-c", "echo ok > /data/smoke.txt && cat /data/smoke.txt"]
      volumeMounts:
        - name: data
          mountPath: /data
  volumes:
    - name: data
      persistentVolumeClaim:
        claimName: $Name
"@

try {
    Invoke-Checked "smoke:apply" {
        $manifest | kubectl apply -f - | Out-Host
    }

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $phase = (kubectl -n $Namespace get pod $Name -o jsonpath="{.status.phase}" 2>$null)
        if ($phase -eq "Succeeded") {
            break
        }
        if ($phase -eq "Failed") {
            kubectl -n $Namespace describe pod $Name | Out-Host
            throw "OpenEBS LVM smoke pod failed."
        }
        Start-Sleep -Seconds 3
    } while ((Get-Date) -lt $deadline)

    if ($phase -ne "Succeeded") {
        kubectl -n $Namespace describe pod $Name | Out-Host
        throw "Timed out waiting for OpenEBS LVM smoke pod to succeed."
    }

    Invoke-Checked "smoke:logs" {
        kubectl -n $Namespace logs pod/$Name | Out-Host
    }

    Invoke-Checked "smoke:pvc" {
        kubectl -n $Namespace get pvc $Name | Out-Host
    }
}
finally {
    Invoke-Checked "smoke:cleanup" {
        kubectl -n $Namespace delete pod $Name --ignore-not-found | Out-Host
        kubectl -n $Namespace delete pvc $Name --ignore-not-found | Out-Host
    }
}
