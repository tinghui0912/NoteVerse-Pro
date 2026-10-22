# GitHub merge policy

## Intended policy

- Changes to `main` should flow through independently reviewed pull requests.
- The reviewed PR head must contain current main before merge. There is no global
  one-commit requirement and no prohibition on merge commits within feature branches.
- Normal merge commits are the intended landing method.
- Exact-head GitHub Actions evidence is authoritative. Historical runs do not
  validate a changed head.
- Component CI remains path-scoped. Requiring every component's existing checks
  globally could leave unrelated PRs waiting for checks that never run.
- `PR Governance / policy` is the intended stable, globally required workflow/job
  identity. A later settings batch must select the actual check context GitHub
  reports, rather than assuming a display label is an API context name.

## Proposed CI gate

[PR Governance](../../.github/workflows/pr-governance.yml) runs for PRs targeting
`main`, without path filters, including drafts and base-retargeting edits. It checks
out the event's actual PR head with full history, explicitly fetches live
`origin/main`, and requires the merge base to equal that fetched main SHA.
Its log and job summary record the PR number, head, main, merge base, and result.

This is a point-in-time ancestry check. A later main push does not automatically
rerun an existing PR check. Re-fetch main and verify the reviewed head immediately
before merge; a previously green run alone is insufficient after main advances.
The gate neither replaces applicable component CI nor certifies application behavior.

## Observed enforcement status

Read-only API characterization on 2026-10-22 used main
`5c60888baa1bc169368fb191bfc919e71001eea5`.

| Control | Observed status |
| --- | --- |
| Repository visibility / default branch | Private / `main` |
| Main protection | `protected=false`, protection summary `enabled=false` |
| Required checks | None; enforcement level `off` |
| Auto-merge | Disabled by repository setting |
| Merge methods | Normal merge, squash, and rebase all allowed |
| Update-branch setting | `allow_update_branch=false` |
| PR-only changes, current-main freshness, normal-merge-only policy | Procedural/manual; not protected GitHub merge requirements |
| New ancestry gate | Proposed by this PR; CI fails stale heads when executed, but the check is not yet required |

The authenticated owner API identifies `tinghui0912` and reports repository
`permissions.admin=true`. No settings writes were attempted. Basic merge-method
settings are readable; write acceptance remains untested in this batch.

Both owner-authenticated endpoints return HTTP 403 with this message:

> Upgrade to GitHub Pro or make this repository public to enable this feature.

- `GET /repos/tinghui0912/NoteVerse-Pro/rulesets`
- `GET /repos/tinghui0912/NoteVerse-Pro/branches/main/protection`

These are concrete private-repository plan/account limits. The integration also
receives that rulesets response, but its classic-protection response is HTTP 403,
`Resource not accessible by integration`; that integration restriction is distinct
from the owner's plan restriction. The owner user response did not expose a plan
name, so no specific subscription tier is inferred.

Without GitHub protection, a failing CI check does not prevent direct pushes or
merges. This PR-only workflow does not run on direct pushes; even a failing
push-triggered workflow would detect a problem after the push, not prevent it.
No PR requirement, required status check, strict up-to-date requirement, force-push
block, or protected-branch deletion block is configured by this proposal.

## Future platform enforcement

After independent review and merge of this proposal, a separately authorized batch
may re-check availability and, only where supported, require PRs and
`PR Governance / policy`, require an up-to-date branch, block force pushes and
branch deletion, and retain normal merge commits while disabling squash/rebase
landing methods. Branch controls are currently blocked by the owner API's private
repository feature restriction; rulesets are not promised as an available path.
Merge-method switches are exposed to the owner, but a later authorized batch must
verify any write and its resulting state. No visibility change or plan purchase
is part of this policy proposal.

All existing component workflow triggers, path filters, gates, and permissions
remain unchanged. Repository settings, branch protection, and rulesets are not
modified by this PR.
