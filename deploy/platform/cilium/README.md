# Cilium cluster networking

Self-hosted Kubernetes runs on cloud VMs with Cilium **1.20.5**. Nodes use Linux
kernel >= 5.10 and the kernel modules required for eBPF, VXLAN/Geneve and the L7
proxy. Cilium owns networking before application Pods are scheduled. For k3s,
disable Flannel and its network-policy controller (`--flannel-backend=none`,
`--disable-network-policy`); kubeadm installs no competing CNI. Keep kube-proxy
unless the cluster explicitly configures and qualifies Cilium's replacement.

```sh
helm upgrade --install cilium oci://quay.io/cilium/charts/cilium \
  --version 1.20.5 --namespace kube-system \
  -f deploy/platform/cilium/values.yaml
cilium status --wait
```

`values.yaml` uses a portable VXLAN overlay and the in-agent L7/DNS proxy. Geneve is an explicit cluster choice
(`tunnelProtocol=geneve`). Cilium local-node probe handling remains a cluster acceptance requirement.
VM firewalls permit the selected overlay port only
between cluster nodes. Hubble flow collection is enabled; relay/UI exposure is
an optional operator-managed concern. Cilium's privileged node agents belong to
the cluster infrastructure boundary, not the application runtime identity.

Application namespaces contain exclusively `cilium.io/v2` CiliumNetworkPolicy.
Their baseline explicitly enables default deny in both directions and denies
both cloud metadata addresses. Cluster administrators control policy creation;
application runtime ServiceAccounts have no policy-editing authority.

The offline schema is the **unmodified** `openAPIV3Schema` of version `v2` from
the [official pinned CRD](https://github.com/cilium/cilium/blob/v1.20.5/pkg/k8s/apis/cilium.io/client/crds/v2/ciliumnetworkpolicies.yaml).
Upstream YAML SHA-256:
`5d9d055b16209e8b20eb7ec4a2fda24697ee333d45ac165ed5eadc111ae7371c`.
Extracted UTF-8 JSON SHA-256 (LF line endings):
`8a93660773d331cbcef604fdee3a415bbd696f5a908fb7c0a9e5e653c3d59101`.
Schema copyright belongs to the Cilium authors, SPDX Apache-2.0.

`scripts/cilium_schema.py` verifies that digest, validates offline with JSON Schema,
and rejects unknown structural fields rather than accepting Kubernetes pruning.
It implements the schema's RE2 printable-Unicode expression with Unicode
categories. Cilium CEL/agent semantic validation and live dataplane enforcement
also require a real cluster; offline schema validation does not substitute for them.

See the [runtime traffic contract](../../../docs/architecture/runtime/container-and-network-hardening.md)
for release inputs and positive/negative DNS, HTTPS, IMDS and cross-runtime probes.
The [official requirements](https://docs.cilium.io/en/v1.20/operations/system_requirements/)
and [DNS policy guide](https://docs.cilium.io/en/v1.20/security/dns/)
describe cluster prerequisites and DNS proxy enforcement.

Internal DNS search suffixes use the pinned version's leading `**.`
[multi-label matcher](https://github.com/cilium/cilium/blob/v1.20.5/pkg/fqdn/matchpattern/matchpattern.go).
This pattern appears only in kube-dns L7 rules for `cluster.local`, never in
external HTTPS `toFQDNs` inputs.
