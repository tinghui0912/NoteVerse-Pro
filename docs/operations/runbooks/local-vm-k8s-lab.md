# Local VM Kubernetes Lab Runbook

This runbook describes the higher-fidelity local staging lab for NoteVerse.

Use this path when the goal is to validate production-like node behavior that
Docker-driver minikube cannot model well:

- real block devices for LVM-backed local PVs;
- GPU worker scheduling and NVIDIA runtime;
- multi-node failure and placement behavior;
- model cache per compute node.

This is not the fastest local development path. It is a production deployment
rehearsal path.

## Recommended Role

Keep two local Kubernetes paths with clear responsibilities:

| Path | Purpose |
| --- | --- |
| qemu2 minikube profile | Fast production-shaped release rehearsal: Gateway API, TLS, S3, Secrets, release packages, observability, LVM StorageClass |
| Local VM Kubernetes lab | Full node-runtime rehearsal: real block disks, OpenEBS Local PV LVM, GPU worker, model cache, node failure behavior |

Do not use Docker volumes mounted into Docker-driver minikube nodes to simulate
LVM. Docker volumes are filesystem mounts, not block devices.

## VM Shape

Minimum practical lab:

```text
control-plane VM
worker VM
gpu-worker VM
```

For a smaller first pass:

```text
control-plane VM
worker VM with one extra virtual disk
```

Recommended VM configuration:

| VM | CPU | Memory | Disk |
| --- | ---: | ---: | --- |
| control-plane | 2-4 vCPU | 4-8 GiB | OS disk |
| worker | 4 vCPU | 8-16 GiB | OS disk + data disk |
| gpu-worker | 6+ vCPU | 24+ GiB | OS disk + model/cache disk + GPU passthrough |

The data disk should appear inside the Linux VM as a block device, for example
`/dev/sdb` or `/dev/vdb`. Create an LVM volume group from that disk and let the
Kubernetes local PV provisioner allocate logical volumes.

## Storage Model

Application product files still use S3-compatible object storage:

- uploads;
- score revision sources;
- rendered score images;
- playback audio;
- temporary import/review objects that must survive pod restarts.

Local block storage is reserved for:

- Prometheus TSDB;
- Alertmanager state;
- Grafana state;
- node-local model cache if the node owns the cache path.

Recommended local PV provider:

```text
OpenEBS Local PV LVM
```

Provisioning contract:

```text
extra virtual disk
  -> LVM physical volume
  -> VG noteverse-local-vg
  -> OpenEBS Local PV LVM
  -> StorageClass/noteverse-local-lvm
  -> PVCs
```

## GPU Worker

## Virtualization Choice

GPU support differs sharply by hypervisor. Do not treat "3D acceleration" as
CUDA-capable GPU passthrough.

Reference points:

- Microsoft documents Hyper-V Discrete Device Assignment as a Windows Server
  feature for passing a whole PCIe device, including graphics devices, into a
  VM: <https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/deploy/deploying-graphics-devices-using-dda>
- NVIDIA vGPU has a formal product support matrix and supported hypervisor
  list. Treat vGPU as a licensed enterprise stack, not a generic desktop VM
  feature: <https://docs.nvidia.com/vgpu/latest/product-support-matrix/index.html>
- VMware's ML-on-vSphere guidance discusses VMDirectPath I/O passthrough and
  NVIDIA vGPU for vSphere, which is different from VMware Workstation desktop
  3D acceleration:
  <https://blogs.vmware.com/wp-content/uploads/sites/105/2019/10/5521-VMW-GPU-MACHINE-LEARNING-GUIDE-USLET-WEB-20190926.pdf>
- Oracle VirtualBox PCI passthrough documentation is for old VirtualBox 6.0
  administrative flows and depends on IOMMU-capable hosts. It is not a practical
  Windows desktop GPU-worker rehearsal path:
  <https://docs.oracle.com/en/virtualization/virtualbox/6.0/admin/pcipassthrough.html>

| Option | GPU support reality | Fit for NoteVerse |
| --- | --- | --- |
| VMware Workstation on Windows | 3D-accelerated virtual GPU only; not suitable for CUDA passthrough into Linux guests | Not recommended for GPU worker validation |
| Oracle VirtualBox on Windows | No practical PCIe GPU passthrough path on modern Windows hosts | Not recommended |
| Hyper-V on Windows Server | Discrete Device Assignment can pass a whole PCIe GPU to a VM when hardware and driver constraints are met | Possible, but more server-oriented and operationally fussy |
| Hyper-V GPU-P on Windows client | GPU partitioning can work for some Windows/WSL-style scenarios, but it is not the same as production Linux GPU node passthrough | Not recommended as the main Kubernetes GPU rehearsal path |
| Linux KVM/QEMU with VFIO | Mature direct PCIe passthrough model when IOMMU, BIOS, GPU isolation, and drivers are correct | Recommended for self-managed local GPU lab |
| VMware ESXi/vSphere | Mature enterprise passthrough/vGPU model; vGPU requires supported NVIDIA hardware and licensing | Recommended if you are willing to run a real type-1 lab hypervisor |
| Proxmox VE | KVM/VFIO based, operationally approachable, good UI for homelab/local staging | Recommended practical choice for local production-like GPU lab |

Recommendation:

```text
Short term:
  Use qemu2 minikube for release/Gateway/TLS/S3/observability/LVM rehearsal.
  Keep backend-worker in Docker Compose for functional OMR testing.

Stronger local staging lab:
  Use Proxmox VE or a Linux KVM host if you can dedicate hardware.
  Use GPU passthrough to one Kubernetes worker VM.

Enterprise-style lab:
  Use VMware ESXi/vSphere with PCI passthrough or NVIDIA vGPU if licensing and
  supported GPUs are available.
```

For a Windows desktop workstation, the cleanest low-maintenance path is usually
not to force GPU passthrough through a desktop hypervisor. Use the Windows host
for development and either:

- run the GPU worker locally with Docker Compose; or
- dedicate a Linux/Proxmox/ESXi machine as the Kubernetes GPU worker lab.

## GPU Worker Runtime

The GPU worker path requires all of these layers to be valid:

```text
Windows host GPU support
  -> desktop virtualization GPU passthrough or vGPU support
  -> Linux guest NVIDIA driver
  -> NVIDIA Container Toolkit
  -> Kubernetes NVIDIA device plugin
  -> backend-worker pod requests nvidia.com/gpu
  -> model cache mounted at /opt/noteverse/models
```

If any layer is missing, run the worker locally through Docker Compose for
functional OMR testing and keep Kubernetes worker replicas at zero.

Do not treat GPU passthrough as a Kubernetes feature. Kubernetes only schedules
the GPU resource after the VM and container runtime expose it correctly.

## Cluster Bootstrap

Use a standard Kubernetes installer such as kubeadm, k3s, or Talos. Keep the
application deployment model identical to minikube and production:

- GHCR images;
- registry pull Secret;
- Kubernetes Secrets;
- cert-manager;
- Gateway API;
- Envoy Gateway;
- S3-compatible object storage;
- OpenEBS Local PV LVM StorageClass;
- observability stack with S3-backed Loki/Tempo.

The same rendered release overlay can be used if the hosts, TLS Secret name,
image refs, and environment ConfigMaps match the target lab.

## Validation Checklist

Block storage:

```bash
kubectl get storageclass noteverse-local-lvm
kubectl get csinodes
kubectl get pvc -A
```

GPU:

```bash
nvidia-smi
kubectl get nodes -o json | jq '.items[].status.allocatable'
kubectl describe node <gpu-node-name>
```

Application:

```bash
kubectl get pods -n noteverse-staging -o wide
kubectl get gateway,httproute -n noteverse-staging
kubectl get certificate -n noteverse-staging
```

End-to-end:

1. Upload a score image.
2. Confirm the import job is processed by the GPU worker.
3. Open review.
4. Confirm score.
5. Confirm rendered image and playback audio assets are available.
6. Confirm logs, metrics, and traces appear in Grafana.

## Production Alignment

This VM lab is closer to production than Docker-driver minikube for storage and
GPU validation, but it is still not production:

- it does not test cloud load balancer behavior unless explicitly configured;
- it may not match production GPU SKU, driver, or CUDA version;
- it does not replace managed PostgreSQL, Redis, S3, mail provider, or DNS
  staging accounts.

Use it to de-risk node-level behavior before moving to a real staging or
production Kubernetes cluster.
