# ADR 0004: Score Access, Collaboration And Guest Preview

- Status: Accepted
- Date: 2026-11-02
- Scope: score-domain authorization

## Decision

Score access has three explicit origins: OWNER, MEMBERSHIP and GUEST_PREVIEW.
There is no public score publication channel. ScoreLibraryEntry organizes a user's
library and does not grant access.

ScoreAccessPolicy authorizes authenticated owner/member operations. The owner can
view, edit, delete, download, practice and manage members and Guest Previews.
Membership roles remain EDITOR and VIEWER. Both can view and practice; only EDITOR
can edit and download. Neither role manages members or Guest Previews.

ScoreGuestPreviewGrant is a separate bearer presentation authority. Only the owner
creates it. Creation pins the resolved current ScoreRevision; later head changes do
not change its contents. A composite foreign key binds that revision to the Score.
The grant expires within 30 days (default seven), is revocable one-way, and is removed
with its Score/revision. Persistence stores a unique token hash. Only creation
returns the high-entropy raw token; lists and logs never disclose it.

## Presentation boundary

Guest Preview serves only exact-revision rendered page images inline and generated
audio for listening. Missing assets remain unavailable; another revision is never a
fallback. Active previews protect their pinned presentation assets from historical
asset cleanup; expired or revoked previews do not. Score deletion remains authoritative.
The bearer response has no source metadata or generic Score capabilities.

Guest Preview cannot deliver MusicXML, practice, edit, offer image/archive downloads,
bookmark, redeem, create membership, or grant persistent authenticated Score access.
Ambient login does not strengthen the bearer channel. The page has no account
actions and uses noindex, nofollow and noarchive. Token-bearing delivery is private,
no-store. Images can still be copied by browsers; this is not DRM.

Collaboration Invite is the authenticated membership entrance. It is independent of
Guest Preview and of any future personal practice sharing authorization.
