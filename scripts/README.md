# Repository Scripts

This folder contains automation that coordinates more than one runtime, the repository as a whole, Kubernetes, release packages, GitOps, or observability. It is not the place for app-only implementation helpers.

## Supported entry points

| Command | Purpose |
| --- | --- |
| `quality.ps1` | Repository quality wrapper. Run `./scripts/quality.ps1 -Check <check>`. |
| `check_markdown_links.py` | Validates checked-in local Markdown links. Run `python scripts/check_markdown_links.py`. |
| `check_k8s_application_manifests.py` | Validates Kubernetes application templates and rendered overlays. |
| `check_k8s_config_ownership.py` | Validates Kubernetes env-file ownership boundaries. |
| `check_observability_manifests.py` | Validates observability values and policy guardrails. |
| `render_k8s_release_overlay.py` | Renders a release overlay for validation or packaging. |
| `promote_release_package_to_gitops.py` | Promotes a verified release package to GitOps desired state. |

## Safety rules

- Read a script's `--help` and its linked runbook before using release, promotion, secret, Minikube, or storage scripts.
- Treat `minikube_*`, `argocd_*`, `promote_*`, and `ensure_s3_bucket.py` as environment-mutating operational tools, not ordinary local checks.
- New scripts belong here only when they have cross-project ownership. Add the command to this index and to the relevant runbook or quality guide.
