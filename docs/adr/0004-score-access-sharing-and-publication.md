# ADR 0004: Centralize Score Access And Separate Grants From Publication

- Status: Accepted
- Date: 2026-06-22
- Scope: P0-1 score-domain contract

## Context

Current authorization is distributed across task dependencies, file services, share services,
practice services, and saved-share queries. A share token directly carries `can_edit`, while
saved shares also participate in access. Adding public scores on top of those branches would
make permissions difficult to audit.

## Decision

1. A score-domain policy evaluates typed actions against a server-derived access context.
2. Persistent authenticated collaboration uses `ScoreMembership` roles `EDITOR` or `VIEWER`.
   Ownership remains sourced from `Score.owner_user_id`.
3. `ScoreShareGrant` is a bearer entrance grant with scope `VIEW` or `EDIT_INVITE`.
4. A valid VIEW grant may authorize anonymous read, download, or practice according to its
   explicit flags.
5. EDIT_INVITE never authorizes anonymous writes. An authenticated user explicitly redeems it
   into an EDITOR membership.
6. Raw grant tokens are returned once and never persisted. Lookup uses a deterministic secure
   digest of the high-entropy token.
7. `ScoreBookmark` organizes a user's library and grants no access by itself.
8. A saved VIEW link records `ShareGrantRedemption`; its access remains bounded by the source
   grant's expiry and revocation.
9. `ScorePublication` is a public-channel configuration that pins one revision. Only the owner
   may publish, republish, unpublish, or manage public policy.
10. Editing the score head never changes public content until explicit republish.
11. Public access is read-only. Download and practice require publication flags.
12. No persisted `PublishedScoreView` is introduced until real discovery queries justify it.

## Policy actions

```text
VIEW_SCORE
VIEW_REVISION
EDIT_SCORE
DOWNLOAD_ARTIFACT
START_PRACTICE
CREATE_SHARE
MANAGE_MEMBERS
PUBLISH_SCORE
MANAGE_SCORE
```

Every endpoint enforces an action. Returned capabilities are contextual UI hints and cannot
replace endpoint authorization.

## Capability examples

| Context | View | Edit | Download | Practice | Share | Publish/manage |
| --- | --- | --- | --- | --- | --- | --- |
| owner | yes | yes | yes | yes | yes | yes |
| editor membership | yes | yes | policy | policy | no | no |
| viewer membership | yes | no | policy | policy | no | no |
| anonymous VIEW grant | yes | no | grant flag | grant flag | no | no |
| authenticated EDIT_INVITE before acceptance | view if granted | no | grant flag | grant flag | no | no |
| editor after invite acceptance | yes | yes | policy | policy | no | no |
| public publication | yes | no | publication flag | publication flag | no | no |

## Access context

The server derives:

```text
subject + score + optional revision + route channel
+ validated membership/grant/publication + requested action
```

The client cannot select a trusted `access_mode`. Practice records the resolved origin and
pinned revision, never a raw share token.

## Consequences

- Share, file, XML, publication, and practice routes use one auditable policy source.
- Editable collaboration becomes attributable to an authenticated user.
- Revoking a VIEW grant removes grant-derived access without silently deleting bookmarks.
- Public routes can use optional authentication for account actions without making results or
  editor routes public.
- The frontend receives consistent capabilities for owner/member/share/public read models.

## Rejected alternatives

- Add `is_public` to `Task`: rejected because job identity and public score identity differ.
- Let an EDIT token write anonymously: rejected because edits require attribution and durable
  membership semantics.
- Treat bookmarks as ACL rows: rejected because organization and authorization have different
  lifecycles.
- Add per-revision ACLs: rejected because no current product requirement varies member rights
  by revision.

