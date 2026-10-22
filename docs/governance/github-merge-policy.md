# GitHub merge policy

## Intended policy

- Changes to `main` should flow through independently reviewed pull requests.
- The reviewed PR head must contain current main before merge. There is no global
  one-commit requirement and no prohibition on merge commits within feature branches.
- Normal merge commits are the intended landing method and the only enabled PR
  merge method after BATCH 56.
- Exact-head GitHub Actions evidence is authoritative. Historical runs do not
  validate a changed head.
- Component CI remains path-scoped. Requiring every component's existing checks
  globally could leave unrelated PRs waiting for checks that never run.
- `PR Governance / policy` is the stable workflow/job identity intended for future
  global enforcement. Its actual GitHub check context is `policy`, produced by
  GitHub Actions. It is not currently a required check.

## PR Governance check

[PR Governance](../../.github/workflows/pr-governance.yml) runs for PRs targeting
`main`, without path filters, including drafts and base-retargeting edits. It checks
out the event's actual PR head with full history, explicitly fetches live
`origin/main`, and requires the merge base to equal that fetched main SHA.
Its log and job summary record the PR number, head, main, merge base, and result.
In other words, current main must be an ancestor of the PR head.

`PR Governance / policy` evaluates custom policy as a GitHub Actions-produced
check. It is currently a detector and evidence producer, not a merge-blocking
rule: branch protection and rulesets are unavailable/unconfigured. A future
supported branch rule could require the actual check context `policy`; no such
configuration is present today.

This is a point-in-time ancestry check. A later main push does not automatically
rerun an existing PR check. Re-fetch main and verify the reviewed head immediately
before merge; a previously green run alone is insufficient after main advances.
The gate neither replaces applicable component CI nor certifies application behavior.

## Historical enforcement observation: PR #119 review

Read-only API characterization on 2026-10-22 used main
`5c60888baa1bc169368fb191bfc919e71001eea5`. The following observations describe
the PR #119 review before BATCH 56, not the current merge-method settings.

| Control | Observed status |
| --- | --- |
| Repository visibility / default branch | Private / `main` |
| Main protection | `protected=false`, protection summary `enabled=false` |
| Required checks | None; enforcement level `off` |
| Auto-merge | Disabled by repository setting |
| Merge methods | Normal merge, squash, and rebase all allowed |
| Update-branch setting | `allow_update_branch=false` |
| PR-only changes, current-main freshness, normal-merge-only policy | Procedural/manual; not protected GitHub merge requirements |
| New ancestry gate | Then proposed by PR #119; CI fails stale heads when executed, but the check was not required |

The authenticated owner API identified `tinghui0912` and reported repository
`permissions.admin=true`. No settings writes were attempted in that observation.
Basic merge-method settings were readable; write acceptance was then untested.

Both owner-authenticated endpoints returned HTTP 403 with this message:

> Upgrade to GitHub Pro or make this repository public to enable this feature.

- `GET /repos/tinghui0912/NoteVerse-Pro/rulesets`
- `GET /repos/tinghui0912/NoteVerse-Pro/branches/main/protection`

These were concrete private-repository plan/account limits. The integration also
received that rulesets response, but its classic-protection response was HTTP 403,
`Resource not accessible by integration`; that integration restriction is distinct
from the owner's plan restriction. The owner user response did not expose a plan
name, so no specific subscription tier is inferred.

Without GitHub protection, a failing CI check does not prevent direct pushes or
merges. This PR-only workflow does not run on direct pushes; even a failing
push-triggered workflow would detect a problem after the push, not prevent it.
No PR requirement, required status check, strict up-to-date requirement, force-push
block, or protected-branch deletion block was configured by PR #119.

## Current merge-method enforcement after BATCH 56

Later on 2026-10-22, BATCH 56 updated repository merge-method settings. Live API
verification for this documentation update uses main
`f262c27bf0224fa2b0ed56db790cac7dcd350a74` and confirms:

| Repository setting | Current value / effect |
| --- | --- |
| `allow_merge_commit` | `true`: normal merge commits are enabled |
| `allow_squash_merge` | `false`: squash merges are disabled at repository settings level |
| `allow_rebase_merge` | `false`: rebase merges are disabled at repository settings level |
| `allow_auto_merge` | `false`: auto-merge remains disabled |
| `allow_update_branch` | `false`: update-branch remains disabled |
| Visibility / default branch | Private / `main`, unchanged |

These merge-method restrictions are actual GitHub repository enforcement for PR
merges, not merely procedural policy. Normal-merge-only does not imply branch
protection. Main remains unprotected (`protected=false`); required status checks
remain `off`, with empty `contexts` and `checks` lists.

The following controls remain unenforced by GitHub:

- Direct pushes are not prevented; pull requests are not technically required.
- `PR Governance / policy` is not a required check, and component checks are not
  GitHub-required checks.
- Up-to-date branches are not GitHub-enforced.
- Force pushes and branch deletion are not blocked by branch protection.
- Independent review is procedural rather than platform-enforced.

The rulesets endpoint still returns HTTP 403 with the upgrade-or-public message
quoted above. The integration's detailed classic-protection read still returns
HTTP 403, `Resource not accessible by integration`. These responses do not expose
a subscription tier, and no named tier is inferred. No protection or ruleset is
configured; this documentation update changes no repository setting.

## Workflow producer and trust boundary

Repository-defined workflow code is itself versioned repository content and can
be changed by pull requests. Requiring the `policy` check in the future would
strengthen enforcement, but its workflow/check producer must not automatically be
treated as an immutable trust boundary. Future hardening should consider review
and protection of governance-workflow changes or a trusted external enforcement
mechanism. This document does not redesign the workflow.

## Future platform enforcement

In a separately authorized batch, re-check availability and, only where supported,
require PRs and the actual `policy` check context, require an up-to-date branch,
and block force pushes and branch deletion. Retain the normal-merge-only settings
already enforced after BATCH 56. Branch controls remain limited by the private
repository feature restriction; rulesets are not promised as an available path.
No visibility change or plan purchase is part of this policy.

All existing component workflow triggers, path filters, gates, and permissions
remain unchanged. Repository settings, branch protection, and rulesets are not
modified by this PR.
