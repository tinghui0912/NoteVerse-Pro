# Staging GitOps publication gate

Status: **BLOCKED — awaiting a qualified four-image release package**.

`published-release` is deliberately absent. Kustomize manifest generation fails,
so neither a manual sync nor pruning can apply an empty or unqualified release.
The Argo CD Application uses manual sync.

Publish and qualify all four production images on trusted main, resolve their
registry digests, render a release package, then promote it with
`scripts/promote_release_package_to_gitops.py --overwrite`. Promotion replaces
this gate with the self-contained digest-pinned release. Review its GitOps PR
before syncing. No deployment digest is inferred from a different image.
