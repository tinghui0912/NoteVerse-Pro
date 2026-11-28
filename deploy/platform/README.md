# Platform Manifests

This directory contains cluster platform examples that support the application
overlays. They are intentionally not included by `deploy/application`.

Platform resources are owned by operators, not application releases.

Included examples:

- `gateway-api/*`: Gateway API and Envoy Gateway installation guidance;
- `cert-manager/*`: cert-manager `ClusterIssuer` examples for Let's Encrypt
  DNS-01 through Cloudflare;
- `storage/*`: StorageClass and PVC ownership guidance for minikube/staging
  and production.

Apply these before deploying the application overlay when running production or
production-flow rehearsal.

## Infrastructure privilege boundary

Application runtime security is defined by
[Container and Network Hardening](../../docs/architecture/runtime/container-and-network-hardening.md).
Envoy Gateway, cert-manager and Argo CD reconcile Kubernetes resources and retain
chart-defined service-account RBAC. Storage and network controllers (OpenEBS LVM,
MetalLB and the cluster CNI) need node/network capabilities independently of the
application's UID and NetworkPolicy. Application manifests do not grant these
privileges. Audit the exact rendered platform chart version and cluster admission
policy before installation; application policy tests do not certify infrastructure
controller privileges or CNI enforcement.
