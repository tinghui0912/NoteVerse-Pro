# NoteVerse Documentation

Everything linked here describes the current repository or an accepted current decision.
Implementation history is retrieved from Git, pull requests and issues rather than maintained as parallel documentation.

## Product

- [Library and My Scores](product/library-and-my-scores.md)
- [Score Invite Collaboration](product/score-invite-collaboration.md)
- [Invitations and Notifications](product/notifications.md)
- [Practice Product Contract](architecture/practice-product-contract.md)

## Architecture and Decisions

- [Architecture Index](architecture/README.md): runtime, editor, integrations and accepted ADRs
- [Backend Dependency Ownership](architecture/runtime/runtime-dependency-ownership.md)
- [Editor Workbench](architecture/editor/editor-workbench.md)
- [Automatic Beaming](architecture/editor/automatic-beaming.md)

## Engineering and Governance

- [Engineering Guides](engineering/README.md)
- [Repository Quality Checks](engineering/guides/repository-quality-checks.md)
- [Dependency Maintenance Policy](governance/dependency-maintenance-policy.md)
- [GitHub Merge Policy](governance/github-merge-policy.md)

## Operations and Security

- [Operations Index](operations/README.md): deployment, delivery, observability and runbooks
- [Security Index](security/README.md): authorization and identity contracts
- [Minikube From Zero](operations/runbooks/minikube-from-zero.md)

Implementation work and follow-up acceptance criteria belong in GitHub Issues and
Projects. Issue #128 is the migration ledger for the migrations governed there.
