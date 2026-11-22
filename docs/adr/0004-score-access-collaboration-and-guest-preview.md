# ADR 0004: Score Access, Collaboration And Guest Preview

- Status: Accepted
- Date: 2026-11-02
- Scope: score-domain authorization

## Decision

Authenticated Score access has two origins: OWNER and MEMBERSHIP. Guest Preview
is a separate presentation-only bearer authority.
There is no public score publication channel. ScoreLibraryOrganization organizes a user's
library and does not grant access.

ScoreAccessPolicy authorizes authenticated owner/member operations. The owner can
view, edit, delete, download, practice and manage members and Guest Previews.
Membership roles are VIEWER, PRACTITIONER and EDITOR, ranked 1, 2 and 3.
Invites default to VIEWER. Accepting a stronger invite upgrades membership; a weaker
invite does not downgrade it. Owner member-management commands can explicitly change
roles in either direction. Revocation immediately removes subsequent access.

All member roles can leave by revoking their own membership through
`DELETE /api/v1/me/scores/{score_id}/membership`; owners cannot leave ownership.
Self leave and owner member removal are separate actor commands. Membership role
updates and revocations lock and refresh the current row. Role updates apply only
to active memberships. Only explicit acceptance of a new valid invitation can
reactivate a revoked membership. Library organization remains personal state and
does not grant access while membership is revoked.

ScoreInvite stores an optional actor terminal outcome: ACCEPTED, DECLINED or
REVOKED, with one terminal timestamp and actor. Unresolved invitations are PENDING
until expires_at, then project EXPIRED without any database lifecycle write.
Effective status and admission are pure computations at an explicit current time.
Actor commands lock and refresh Invite before admission; only application commands
commit. Accept locks Invite before Membership and commits both changes together.
Revoke is idempotent for REVOKED, preserving its terminal time and actor. Actor
outcomes are retained history, distinct from current Membership access: removing
a member or leaving a Score does not rewrite the accepted invitation.

VIEWER can view rendered presentation only. PRACTITIONER can also practice, which
necessarily discloses exact machine-readable PracticeBundle to that trusted browser.
EDITOR can also edit, requiring revision MusicXML and original editing inputs in its
browser. These disclosures are not DRM. Only the owner can use explicit MusicXML,
render-page/archive download and download access-URL actions. Members cannot manage
members or Guest Previews.

Revision content, history, revision mutation and raw input material require EDIT.
Viewer/Practitioner read models contain no source metadata or raw input identifiers.
Authenticated generated playback requires PRACTICE. Presentation image viewing is
inline VIEW access, separate from DOWNLOAD. Score membership confers no visibility
into another user's personal practice data.

Score does not store Guest Preview credentials. At most one active
GuestPreviewCredential exists per Score; its presence enables bearer access. The
secret is high entropy and persisted only as a SHA-256 lookup hash. Only the owner
can issue, revoke or rotate it. Issue and rotate reveal plaintext once; settings
expose only enabled state and issue time. Revoke immediately removes active
authority, and re-enable issues a fresh credential. Rotation invalidates the
previous link. Credential commands lock Score before the credential, without
changing Score metadata version or recency. There is no expiry, revision pin or
credential history.

The owner UI keeps a newly revealed link only in transient component/mutation
memory. Settings caches contain no secret. Reloading shows enabled state with the
secret hidden; rotating supplies a new link when the owner needs one. Settings,
credential commands and bearer responses, including errors, are private, no-store.

## Presentation boundary

Guest Preview resolves the current Score head on every read, image and playback
request. It serves only that head's `SCORE_PRESENTATION_RENDER_PROFILE` rendered
pages inline and generated audio for
listening. Missing current-head assets remain unavailable; another revision is never
a fallback. A page identifier obtained before a head change cannot deliver the old
revision. Shared attribution comes from the Score owner. The response contains no
revision identity, source metadata or generic Score capabilities.

Only the current Score head is normal durable presentation demand and is protected
by derived-asset retention. Guest Preview does not dispatch work or retain historical
Render/Playback assets. Workers check presentation demand under the Score lock after
physical generation and before semantic adoption. Work superseded by a head change
becomes SUPERSEDED; unadopted writes remain under ObjectWriteIntent cleanup. Canonical
revision history and sources remain intact.

Guest Preview cannot deliver MusicXML, practice, edit, offer image/archive downloads,
bookmark, redeem, create membership, or grant persistent authenticated Score access.
Ambient login does not strengthen the bearer channel. The page has no account
actions and uses noindex, nofollow and noarchive. Token-bearing delivery is private,
no-store. Images can still be copied by browsers; this is not DRM.

Collaboration Invite is the authenticated membership entrance. It is independent of
Guest Preview and of any future personal practice sharing authorization.

## Frontend ownership

The Customer Score product has distinct `features/scores/core`,
`features/scores/collaboration` and `features/scores/guest-preview` lifecycle owners.
Each owns its API/query/cache presentation boundary. Parent Score composition combines
those surfaces and named cross-lifecycle cache consequences. Frontend capability
presentation consumes backend `ScoreCapabilities`; it does not infer authorization
from Membership roles. The public Guest Preview surface consumes bearer presentation
without ambient authenticated Score capabilities.
