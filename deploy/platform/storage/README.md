# Platform Storage

This directory documents Kubernetes storage primitives owned by platform
operators, not by application releases.

## NoteVerse Storage Policy

Application product files use S3-compatible object storage:

- uploaded source files;
- canonical score revision sources;
- rendered score images;
- playback audio;
- temporary import/review objects that must survive pod restarts.

Observability object stores also use dedicated S3-compatible buckets:

- Loki bucket for logs;
- Tempo bucket for traces.

Kubernetes PVCs are reserved for infrastructure state that is naturally local
block storage:

- Prometheus TSDB;
- Alertmanager state;
- Grafana state;
- node-local model cache, where applicable.

Do not create PVCs for NoteVerse uploaded files, score sources, render assets,
or playback assets.

## Minikube/Staging StorageClass

Minikube is treated as the staging rehearsal environment. It should exercise a
dynamic `StorageClass` backed by node-local block storage. This keeps the local
cluster close to a production self-managed Kubernetes cluster with local SSDs.

The repository standard for minikube is:

```text
StorageClass/noteverse-local-lvm
```

Provided by:

```text
OpenEBS Local PV LVM
```

The required local shape is:

```text
qemu2 minikube profile
  -> extra block disk on each node
  -> LVM volume group noteverse-local-vg
  -> OpenEBS Local PV LVM
  -> StorageClass/noteverse-local-lvm
```

Install through:

```powershell
.\scripts\minikube_start_lvm_profile.ps1
.\scripts\minikube_prepare_lvm_vg.ps1 -WipeExtraDisk
.\scripts\minikube_install_openebs_lvm.ps1
```

The Docker minikube driver cannot provide real extra block disks to the nodes.
Docker volumes are filesystem mounts, not block devices, and should not be used
to simulate LVM for this project.

This keeps application and observability Helm values close to production:

```text
Chart values
  -> PVC
  -> StorageClass
  -> provisioner
  -> node-local disk
```

The workload manifests do not know node filesystem paths.

## Production StorageClass

Production should not blindly copy the minikube profile command, but the storage
contract should stay the same: workloads request PVCs from a named
StorageClass, and platform storage owns the disk implementation.
Choose the provisioner based on the cluster substrate:

| Environment | Recommended provisioner |
| --- | --- |
| Managed cloud Kubernetes | Cloud block storage CSI, such as EBS CSI, GCE PD CSI, Azure Disk CSI, or the cloud provider equivalent |
| Self-managed Kubernetes with local SSDs | OpenEBS Local PV LVM, OpenEBS Local PV ZFS, or another operator-managed local PV provisioner |
| Multi-node shared POSIX filesystem need | CephFS/Rook, EFS, NFS, or another shared filesystem CSI, only when the workload genuinely needs RWX |

For the first NoteVerse production environment, prefer:

```text
Prometheus/Grafana/Alertmanager -> cloud block storage CSI
Loki/Tempo -> S3-compatible object storage
Application assets -> S3-compatible object storage
Model assets -> node-local model cache
```

OpenEBS Local PV can be used in production for node-local workloads, but it is
not a generic high-availability storage layer by itself. If the node or disk is
lost, the local volume is lost unless the workload has a separate replication
or recovery model. This is acceptable for model cache and some observability
scratch cases, but not for irreplaceable product data.

## Why Not Direct hostPath?

Direct `hostPath` couples workload manifests to node filesystem layout. A PVC
through a StorageClass keeps that boundary clean and is much closer to
production Kubernetes.

For NoteVerse, direct `hostPath` is only acceptable for node-local model cache
DaemonSets where the node directory itself is the explicit cache contract. It is
not the standard for Prometheus, Grafana, Alertmanager, or application data.
