# Score Invite Collaboration

## Access and lifecycle

Score ownership and authenticated membership authorize editing. Bearer share
links authorize view/download according to their policy; they cannot grant
editable membership. The owner manages members and targeted email invitations
through the score collaboration surface.

An invite has a high-entropy opaque token returned once, with only its hash
stored in the database. Its email, requested role, issuer, expiry and lifecycle
are server-owned. States include pending, accepted, declined, revoked and expired.
List and management APIs do not reveal raw tokens.

`/invite/:token` presents the invitation. Login/registration preserves the return
URL, and acceptance requires the authenticated account's normalized email to
match. Acceptance creates/restores/upgrades membership without downgrading a
stronger existing role, then opens `/score/:id`. Inactive invitations cannot
authorize acceptance. Pending invite APIs also support account-scoped accept
and decline by invite identifier.

The owner's score UI separates collaboration management from view-only sharing.
Capability flags control presentation, while backend action policy authorizes
every request. An editor member does not become the quota/storage owner.

## Delivery and notification

Creating an invitation commits its record and requests a localized transactional
email through `dispatch_email()`. The public link origin is `FRONTEND_BASE_URL`.
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
