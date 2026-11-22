# Invitations and Notifications

The notification center separates pending actions from durable notification history.
Pending score invites belong to the authenticated user's normalized email, including
invitations received before registration. Accept and decline enforce ownership and
current state; accepting creates the intended membership and opens the Score.

`Notification` is semantic user-facing history with read/unread state and retention.
The backend persists one of five typed kinds: invite accepted, invite declined, Score
version created, Import completed or Import failed. Each kind carries its explicit
invite/Score/revision/Import identity and applicable title snapshots. Final titles and
subtitles are localized by Customer Web; persistence contains no presentation copy or
generic parameter bag. Actor presentation hydrates the current User identity.

The API returns a discriminated `kind` union. The UI supports All/Unread, date grouping,
bounded error/retry states and optimistic read updates. Counts combine pending actions
and unread notifications without turning pending invitations into notification rows.

Invite responses notify the inviter. Non-initial revisions notify eligible owners and
active members excluding the actor. Import failure opens `/upload#import-activity`;
completed Import opens `/imports/:jobId/review` until confirmation supplies a Score target.
Confirmation enriches the retained completed notification in its business transaction.
A notification removed by retention does not block confirmation or recreate history.

Revision, Import and invite consequences admit Notification and RealtimeChange rows
inside the owning business transaction. All deterministic database consequences commit
or roll back together. Mark-one-read emits a single-notification change only for an
unread-to-read transition. Mark-all-read emits one collection change only if rows change,
so tabs converge through list/count refetch. External delivery and latency hints do not
change a committed business outcome.

Scheduled retention bounds notification history. RealtimeChange is a separate,
short-retention convergence hint, not notification history or an audit stream.
See [realtime changes](../architecture/realtime-changes.md) and
[Score Invite Collaboration](score-invite-collaboration.md).
