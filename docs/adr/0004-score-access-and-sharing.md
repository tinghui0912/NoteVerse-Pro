# ADR 0004: Centralize Score Access And Sharing

- Status: Accepted
- Date: 2026-06-22
- Scope: score-domain contract

## Decision

One server-side ScoreAccessPolicy evaluates actions against an authorized score and
revision. Access origins are OWNER, MEMBERSHIP and SHARE. There is no public score
publication channel.

Ownership comes from Score.owner_user_id. Authenticated collaboration uses
ScoreMembership roles EDITOR and VIEWER. Editors may edit and download; viewers
may view and practice. Both are attributable to a named user. Neither membership
role grants ownership, sharing administration or destructive owner actions.

ScoreShareGrant is a bearer entrance link. Valid grants allow anonymous read,
download according to allow_download, and playback/practice according to the
VIEW/PRACTICE access_mode. Grants never authorize editing. Raw tokens are returned
once; persisted lookup uses their secure hash. Authenticated redemption records
ShareGrantRedemption so grant-derived access remains bounded by expiry and revocation.
ScoreLibraryEntry organizes the user's library and does not grant access itself.

## Actions and capabilities

The policy owns VIEW, EDIT, DELETE, MANAGE_SHARING, MANAGE_MEMBERS, DOWNLOAD and
PRACTICE. ScoreCapabilities reports the corresponding contextual hints. Every endpoint
enforces its action; returned capabilities do not replace server authorization.

Owner/member reads, bearer Share Link, revision assets, playback, Practice admission
and collaboration invites use this central policy. Share Link and Collaboration
Invite are the external score entrances; public publication is not a product channel.
