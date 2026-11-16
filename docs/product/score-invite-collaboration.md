# Score Invite Collaboration

## Access and lifecycle

Score ownership and explicit authenticated membership define trusted collaboration.
VIEWER can view rendered presentation. PRACTITIONER can view and practice. EDITOR
can view, practice and edit. Owner is not a membership role. Only the owner can use
explicit source/render download actions or manage members and Guest Previews.

Invites default to VIEWER. Role rank is VIEWER < PRACTITIONER < EDITOR; acceptance
upgrades weaker membership without downgrading stronger membership. Owner management
supports explicit upgrade/downgrade. Revocation denies subsequent access immediately.
The member collection contains active members only. Remove returns 204 without a
representation; repeated remove and leave preserve the original revocation time.
Every invitation targets an email address, and owner self-invitations are rejected.

Every member role may leave a Score; owners cannot leave their ownership. Self
leave revokes the current user's membership through
`DELETE /api/v1/me/scores/{score_id}/membership`. Owner removal is a distinct
member-management command. Both preserve the membership row and are idempotent
when it is revoked. Membership mutations lock and refresh that row, so concurrent
leave, removal and invite acceptance serialize. Role PATCH only changes active
memberships and cannot restore revoked access; explicit acceptance of a new valid
Invite is the reactivation path.

Score Detail offers Leave through `can_leave`. Shared with me offers single-card
Leave without a folder filter. Other Library scopes and bulk toolbars offer no
Leave action. Leave preserves Score assets, personal practice history and personal
folder/favorite organization. The revoked membership grants no Score or Library
access; organization can become visible again after rejoining through an Invite.

Practice necessarily sends exact PracticeBundle to the Practitioner/Editor browser;
editing sends revision MusicXML and original input assets to Editor. These are trusted
application disclosures, not DRM restrictions. Viewer gets no machine-readable source.
Revision content and history require EDIT; authenticated audio requires PRACTICE.

Guest Preview is a separate current-head image/listen bearer channel. It grants no
Practice, editable membership, source download or persistent account access.

An invite has a high-entropy opaque token returned once, with only its hash
stored in the database. Its email, requested role, issuer, expiry and lifecycle
are server-owned. Effective read statuses are pending, accepted, declined, revoked
and expired.
List and management APIs do not reveal raw tokens. Score invite, membership and
account pending-invite collections use stable cursor pagination with explicit
continuation. Invitations are newest first; memberships are oldest first. Pending
pages contain invitations whose pending status and expiry currently allow action.

`/invite/:token` presents the invitation. Login/registration preserves the return
URL, and acceptance requires the authenticated account's normalized email to
match. Acceptance creates/restores/upgrades membership without downgrading a
stronger existing role, then opens `/score/:id`. Inactive invitations cannot
authorize acceptance. Pending invite APIs also support account-scoped accept
and decline by invite identifier.

An invitation stores an optional actor terminal outcome (ACCEPTED, DECLINED or
REVOKED), terminal_at and terminal actor. With no actor outcome, it projects
PENDING until expires_at and EXPIRED at or after expires_at. Expiry is a pure time
projection: reads and expired command rejection do not write lifecycle state.
Commands lock and refresh Invite before effective-status admission. Application
commands own commits; Accept commits its actor outcome and Membership admission
together, retaining Invite then Membership lock order. Waiting on Membership
requires a fresh expiry check before restoring access. Repeating Revoke preserves
its terminal time and actor; other terminal outcomes reject further actor actions.

The owner Invitations section displays lifecycle status, role and expiry. Pending
rows offer Revoke and offer Copy only when this session still holds the raw token
from creation. Terminal rows offer neither command. List APIs expose no raw token.
Accepted history does not grant access: Member removal and Self Leave revoke
Membership without changing the ACCEPTED Invite.

The owner's score UI separates collaboration management from Guest Preview.
Capability flags control presentation, while backend action policy authorizes
every request. An editor member does not become the quota/storage owner.

## Delivery and notification

Creating an invitation commits its record and localized MailOutbox request together.
The public link origin is `FRONTEND_BASE_URL`.
Mail delivery failure does not undo the invitation. Provider credentials and
sender configuration are environment-owned. A Resend-backed delivery adapter
classifies permanent provider responses separately from retryable failures.

The notification center exposes matching pending actions separately from
persisted outcome history. Accept/decline notify the inviter. See
[Invitations and Notifications](notifications.md) and
[Score Access](../security/score-access-contract.md).

## Validation boundaries

Invite rule tests, query contracts, membership authorization and notification
deduplication define deterministic behavior. A production environment separately
verifies sender-domain configuration, deliverability and browser login/return
behavior. Realtime co-editing is not part of this collaboration contract; score
revision conflict detection remains authoritative for saves.
