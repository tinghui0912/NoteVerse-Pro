# GitHub Merge Policy

## Review contract

Changes to main use independently reviewed pull requests and normal merge
commits. The reviewed head must contain live main. Multiple coherent commits
and merge commits inside feature branches are allowed. Exact-head CI evidence
and an immediate pre-merge main/head check establish the review lease.

Component checks are path-scoped. Requiring unrelated component jobs that do
not run would not be a useful global gate. `PR Governance / policy` is the
ancestry check identity; it does not replace component quality or behavior tests.

## Governance behavior

The workflow checks out the event's PR head, fetches live main and requires the
merge base to equal that main SHA. Logs/summary record PR, head, main and merge
base. Edited/reopened/synchronized PR events are evaluated; merged PRs skip the
policy job under their lifecycle guard.

An ancestry result is point-in-time evidence. Main advancing later does not
automatically refresh every PR. Recheck the exact reviewed revision before
merge and validate the real merge commit and applicable push checks afterward.

## Platform enforcement boundary

Normal merge commits are enabled. Squash, rebase, auto-merge and update-branch
are disabled. Main has no configured protection or required status checks.
Independent review, PR use and up-to-date checks therefore remain procedural;
the workflow detects policy violations rather than preventing direct pushes.

Repository-defined workflow code can itself change in a PR and is not an
immutable external trust producer. Current settings and feature availability
must be checked live when assessing enforcement. No visibility/subscription or
settings change is implied by this policy.
