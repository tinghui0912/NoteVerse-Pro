# CI/CD Trust and Policy Scripts

This directory owns GitHub workflow policy, CI evidence, artifact input identity,
registry publication, candidate promotion and hosted-runner resource lifecycle.
Scripts operate without importing backend application business logic. Artifact
policy may inspect backend project, lock, recipe and contract files as inputs.

| Responsibility | Implementation |
| --- | --- |
| Shared immutable OCI lookup and qualified promotion | `oci_publication.py` |
| API/Beat publication and workflow policy | `backend_service_image_publication.py` |
| Explicit-target Worker dependency identity | `backend_worker_image_identity.py` |
| Worker reuse, publication and workflow policy | `backend_worker_image_publication.py` |
| Ephemeral hosted-runner disk lifecycle | `backend_worker_runner_disk.py` |
| Customer Web CI evidence and trust policy | `customer_web_ci_policy.py` |
| Dependency exception governance | `dependency_governance.py` |

Tests live beside the policy they validate. Backend Quality supplies the Python
tooling environment and runs CI tests separately from backend application tests.
From the repository root:

```sh
uv run --project backend --locked --only-group quality --with-requirements scripts/requirements-manifests.txt python -m pytest .github/scripts -q -c backend/pyproject.toml
```

The Quality workflow also type-checks the real CI helper paths with backend
tooling/configuration. This directory is not a Python project or workspace.

GitHub and registry mutation belongs here. Backend runtime commands and shipped
image contracts belong in [backend/scripts](../../backend/scripts/README.md).
Repository, platform and environment orchestration belongs in
[scripts](../../scripts/README.md).

## Security regression

`backend_security_regression.py` executes the mandatory security and architecture
suite with explicit real PostgreSQL/Redis URLs and rejects skips/xfails or empty
execution. `test_container_security_policy.py` exercises numeric image identity,
Pod/init contexts, exact network traffic, private CIDR inputs, direct Gateway
routing and observability Helm hardening. `test_cilium_network_policy.py` verifies
exact FQDN/DNS authority, metadata deny, single-rule ownership and offline CRD
schema validation on Linux and Windows. Workflows invoke these gates separately
from full backend regression.
