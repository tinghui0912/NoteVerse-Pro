# Invitations and Notifications

The notification center separates pending actions from notification history.
Pending score invites belong to the authenticated user's normalized email,
including invitations received before account registration. Expired or terminal
invites are not pending actions. Accept and decline enforce ownership and state
server-side; accepting creates the intended membership and opens the score.

Persisted `notification_events` are a deduplicated read projection, not the
authority for membership or an application event stream. The API exposes list,
unread count, mark-read and mark-all-read operations. The UI supports All/Unread,
date grouping, bounded error/retry states and optimistic read updates.

Invite outcomes notify the inviter. New revisions notify eligible owners and
members excluding the actor. Import-completed notifications open job review;
failed imports open upload with the job identifier. Confirmation can supply a
score identifier for subsequent navigation. Counts combine pending invitations
and unread notifications without turning an invite into a second notification
record merely to display it.

Scheduled retention removes expired notification history under configured
lifecycle settings. Revision, Import and invite outcomes admit notification history
and corresponding realtime rows/wake-ups in their owning business transaction. These
deterministic database consequences commit or roll back together. External delivery
and post-commit latency hints do not change the committed business outcome.
Authorization and deduplication are required at every producer/read boundary.
See [Score Invite Collaboration](score-invite-collaboration.md).
