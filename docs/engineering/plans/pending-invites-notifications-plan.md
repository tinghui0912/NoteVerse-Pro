# Pending Invites And Notification Center Plan

This document defines the collaboration-notification roadmap after email invites. The current shipped layer lets an invited user see and accept collaboration invites inside the app. The next layer should introduce a notification center for user-visible events such as invite acceptance, invite decline, and future system events.

## Architecture Position

The product is moving from an invite-only collaboration flow toward a broader collaboration-event model, but the project should not jump directly to a full event stream yet.

Recommended current model:

```text
Domain Action
  -> Business State
  -> Notification Event
  -> Notification Center
```

Long-term possible model:

```text
Domain Action
  -> Event Stream
  -> Projections
       - Pending Invites
       - Notification Center
       - Activity Feed
       - Audit Log
```

Current decision:

- `score_invites` remains the source of truth for invitation business state.
- `notification_events` should be introduced next as the source of truth for user-facing notification records.
- A full append-only event stream should be deferred until activity feed, audit replay, or multiple projections justify the extra complexity.

Why not make Invite a projection now:

- Invites are actionable business state, not only display history.
- The system needs authoritative invite transitions: `PENDING`, `ACCEPTED`, `DECLINED`, `REVOKED`, `EXPIRED`.
- Notification records should tell users what happened; they should not decide whether an invite is valid.

## Current State

- Collaboration invite records already live in `score_invites`.
- Invite acceptance already works through `/invite/:token`.
- Invite records are email-targeted.
- Email delivery is useful but not reliable enough to be the only user-facing channel.
- The app has `/me/invites` for actionable pending invites.
- The top navigation has a notification bell that opens the notification center.
- The app has a persisted `notification_events` table for user-facing update notifications.

## Product Direction

Recommended rollout order:

1. Add a user-facing "Pending invites" surface. `Completed`
2. Add a lightweight nav indicator/count. `Completed`
3. Introduce `notification_events` for user-facing updates. `Completed`
4. Build a notification center UI with action-required and updates sections. `Completed`
5. Later evolve into activity feed or event stream if needed.
6. Defer real-time push/WebSocket until collaboration activity becomes dense.

This keeps the MVP focused and avoids building a full message center before the product actually needs one.

## Non-Goals For This Phase

- No browser push notifications.
- No WebSocket or real-time presence.
- No invite comments/activity feed.
- No cross-resource notification framework.

For the next phase, the non-goals change:

- Do not build a full event stream.
- Do not add activity feed or audit log.
- Do not add real-time delivery yet.
- Do not add browser push notifications yet.
- Do not model private messages or chat.

## Target UX

When user B logs in with an email address that has pending collaboration invites:

- B can open a "Pending invites" list from the top navigation or account menu.
- The nav can show a small count when there are pending invites.
- Each invite card shows:
  - score title
  - inviter name/email
  - role: editor/viewer
  - created time
  - expiration if present
  - actions: accept, ignore/reject

After accepting:

- The invite becomes accepted.
- Membership is created or upgraded.
- The user is redirected to `/score/:id`.
- The pending invite disappears from the list.

After rejecting:

- The invite is marked revoked or declined.
- It disappears from the list.

When user B accepts or declines user A's collaboration invite:

- A receives an update notification.
- A can open the notification center from the top-right bell.
- The update notification links back to the score.
- The notification should not require A to inspect invite history to understand what happened.

Future notification center structure:

```text
Notification Center
  Action Required
    Pending invites      // from score_invites
  Updates
    Invite accepted      // from notification_events
    Invite declined      // from notification_events
    Score version saved  // from notification_events
    System events        // from notification_events
```

Important distinction:

- `Action Required` items are tasks the current user can act on.
- `Updates` are events the current user should know about.
- Pending invites remain state-driven.
- Invite accepted/declined updates become notification records.

## Backend Plan

### 1. Extend Invite Status

Current status:

```text
PENDING
ACCEPTED
REVOKED
EXPIRED
```

Add:

```text
DECLINED
```

Rationale:

- `REVOKED` means owner cancelled the invite.
- `DECLINED` means recipient dismissed it.
- These are different product events and should not be overloaded.

Files:

- `backend/app/db/models/score_access.py`
- New Alembic migration to add enum value `DECLINED`
- `backend/app/modules/score_invites/schemas.py`
- `frontend/src/types/api/scores.ts`

### 2. Repository Query For Current User Pending Invites

Add repository method:

```python
pending_invites_for_email(db, email: str) -> list[ScoreInvite]
```

Query rules:

- `email == current_user.email.lower()`
- display status is `PENDING`
- include score and inviter details in service response
- order by `created_at desc`

### 3. New API Endpoints

Add authenticated user-level invite endpoints:

```text
GET  /api/v1/me/invites
POST /api/v1/me/invites/{invite_id}/accept
POST /api/v1/me/invites/{invite_id}/decline
```

Why `/me/invites`:

- The resource is scoped to the current signed-in user.
- It is not tied to a single score page.
- It avoids leaking token-based invite links in list payloads.

Response shape:

```typescript
interface PendingScoreInvite {
  invite_id: string;
  score_id: string;
  score_title: string;
  inviter: InviteActor | null;
  email: string;
  role: MembershipRole;
  status: InviteStatus;
  expires_at: string | null;
  created_at: string;
}
```

Accept endpoint:

- Reuses the same core membership creation logic as token acceptance.
- Does not require exposing the opaque invite token.
- Must enforce the current user's email matches invite email.

Decline endpoint:

- Only the targeted recipient can decline.
- Only pending invites can be declined.
- Sets status to `DECLINED`.
- Sets `revoked_at` or a new `declined_at`.

Decision:

- For a cleaner model, add `declined_at`.
- If keeping schema smaller matters more, reuse `revoked_at` temporarily.
- Recommended: add `declined_at` because status semantics are cleaner.

### 4. Service Refactor

Current `accept_invite(token, user_id)` is token-centric.

Refactor internally:

```python
_accept_invite_record(db, invite, user_id) -> InviteAcceptRead
```

Then call it from:

- `accept_invite(token, user_id)`
- `accept_pending_invite(invite_uuid, user_id)`

This avoids duplicate membership role-upgrade logic.

### 5. Backend Tests

Add coverage in `tests/test_score_revision_services.py` or a new invite-specific test file:

- pending invites list returns only invites for current user's email
- accepted/revoked/expired/declined invites are excluded
- accept by invite id creates membership
- accept by wrong user fails with `invite_email_mismatch`
- decline hides invite from pending list
- expired invite is not listed or is returned as expired depending API decision

## Notification Center Backend Plan

### 1. Add Notification Event Model

Add a persisted notification table, recommended name:

```text
notification_events
```

Suggested fields:

```text
id
notification_uuid
recipient_user_id
actor_user_id
type
dedupe_key
resource_type
resource_id
score_id
title
body
data_json
read_at
created_at
```

Recommended SQLModel enum values:

```text
score_invite.accepted
score_invite.declined
score_invite.revoked
system.processing_done
system.processing_failed
```

MVP can start with only:

```text
score_invite.accepted
score_invite.declined
score.version.created
import.completed
import.failed
system
```

But prefer dotted domain event names because they scale better than broad uppercase buckets.

### 2. Notification Service

Add a small service boundary:

```python
NotificationService.create_event(...)
NotificationService.list_for_user(...)
NotificationService.unread_count(...)
NotificationService.mark_read(...)
NotificationService.mark_all_read(...)
```

Rules:

- Notification creation should not roll back the domain action.
- Notification creation should be idempotent where possible.
- Producers should pass a stable `dedupe_key` for retryable domain outcomes.
- Recipient should be explicit, never inferred in the frontend.
- Use structured `data_json` for links and display details.
- Notification records should have an explicit retention boundary.

### 3. Emit Invite Outcome Notifications

When a recipient accepts an invite:

```text
recipient = invite.created_by_user_id
actor = accepted_by_user_id
type = score_invite.accepted
resource_type = score
resource_id = score.score_uuid
data = { invite_id, score_title, role }
```

When a recipient declines an invite:

```text
recipient = invite.created_by_user_id
actor = declining_user_id
type = score_invite.declined
resource_type = score
resource_id = score.score_uuid
data = { invite_id, score_title, role }
```

Do not notify the actor about their own action unless there is a product reason.

### 4. API Endpoints

Add user-scoped notification endpoints:

```text
GET  /api/v1/me/notifications
GET  /api/v1/me/notifications/unread-count
POST /api/v1/me/notifications/{notification_id}/read
POST /api/v1/me/notifications/read-all
```

Recommended response shape:

```typescript
interface NotificationEvent {
  notification_id: string;
  type: string;
  title: string;
  body: string | null;
  resource_type: string;
  resource_id: string | null;
  score_id: string | null;
  actor: InviteActor | null;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}
```

### 5. Backend Tests

Add tests for:

- accepting an invite creates a notification for the inviter
- declining an invite creates a notification for the inviter
- notification list only returns current user's notifications
- unread count excludes read notifications
- mark-read is scoped to recipient
- notification creation failure does not roll back invite acceptance/decline

## Frontend Plan

### 1. API Client

Add to `frontend/src/lib/api/score-invites.ts`:

```typescript
listMyInvites()
acceptMyInvite(inviteId)
declineMyInvite(inviteId)
```

### 2. Query Keys And Hooks

Add query keys:

```typescript
queryKeys.scores.myInvites()
```

Add hooks:

```typescript
useMyPendingScoreInvites(enabled)
useAcceptMyScoreInvite()
useDeclineMyScoreInvite()
```

Invalidation:

- invalidate `myInvites`
- invalidate `scores.lists()`
- invalidate score detail for accepted score if known

### 3. UI Surface

MVP option:

- Add a "Invites" item in the user menu with count badge.
- Add a dialog/dropdown listing pending invites.

Better follow-up:

- Add `/my-scores/invites` or `/invitations` page if the list becomes longer.

Recommended MVP:

- Top nav user menu item: "Invitations"
- Opens `PendingInvitesDialog`
- Badge appears when count > 0

Reason:

- It avoids adding another page too early.
- It is visible when user logs in.
- It is close to account context.

### 4. Frontend i18n

Add strings under `scoreCollaboration` or a new namespace `notifications`.

Recommended for MVP:

- Keep under `scoreCollaboration` because the only notification type is collaboration invite.
- Split into `notifications` only when adding broader events.

Strings:

- "Invitations"
- "{count} pending"
- "{name} invited you to collaborate"
- "Accept"
- "Decline"
- "No pending invitations"

### 5. Frontend Tests

Add unit/source tests:

- API methods use `/me/invites`
- hooks invalidate correct query keys
- user menu includes invitation entry

Add E2E later:

- account B logs in
- sees invitation count
- accepts
- navigates to score

## Notification Center Frontend Plan

### 1. API Client

Add:

```typescript
listMyNotifications()
getMyNotificationUnreadCount()
markNotificationRead(notificationId)
markAllNotificationsRead()
```

### 2. Query Keys And Hooks

Add:

```typescript
queryKeys.notifications.list()
queryKeys.notifications.unreadCount()
```

Hooks:

```typescript
useMyNotifications()
useMyNotificationUnreadCount()
useMarkNotificationRead()
useMarkAllNotificationsRead()
```

### 3. UI

Upgrade the existing top-right bell:

```text
Bell
  badge = pending invites count + unread notifications count
  click opens NotificationCenterPopover/Dialog
```

Recommended first UI:

```text
Action Required
  PendingInvitesDialog content or embedded pending invite cards

Updates
  notification_events list
```

### 4. i18n

Create a new namespace:

```text
notifications.json
```

Reason:

- Pending invite strings can remain under `scoreCollaboration`.
- General notification strings should not live under score collaboration once system events exist.

### 5. Frontend Tests

Add coverage for:

- bell badge combines pending invites and unread notifications
- notification center renders action-required and updates sections
- mark-read invalidates unread count
- accepted/declined invite notification links to `/score/:id`

## Open Decisions

### Should invite creation create a notification record?

Not yet.

Reason:

- `score_invites` already is the pending invite source of truth.
- The invite recipient needs an actionable pending invite, not just an update notification.
- A notification row for the recipient would duplicate `PENDING` invite state.
- Invite accepted/declined should create notification records for the inviter because those are updates, not actionable invite state.

### Is `notification_events` an event stream?

No.

It is a user-facing notification table that borrows event naming and structure. It should be designed so it can later be fed by an event stream, but it should not introduce replay, projections, or append-only domain sourcing now.

### Should notification delivery be best-effort?

Yes.

Notification creation should be reliable enough for product UX, but it should not roll back critical domain actions such as accepting or declining an invite. If notification insert fails, the service should log the issue and keep the domain state transition.

### Should pending invite count poll?

MVP:

- Use TanStack Query with normal refetch on dialog open.
- Optionally refetch every 60 seconds while authenticated.

No WebSocket yet.

### Should an invite to an unregistered email appear after registration?

Yes.

Because pending invite lookup is email-based, once the user registers and logs in with the invited email, `/me/invites` will find the existing invite.

## Implementation Order

1. Backend enum/model/schema changes. `Completed`
2. Alembic migration. `Completed`
3. Repository method and service APIs. `Completed`
4. Router endpoints under `/me/invites`. `Completed`
5. Backend tests. `Completed`
6. Frontend types and API client. `Completed`
7. Query keys/hooks. `Completed`
8. Pending invites dialog in account/nav area. `Completed`
9. i18n strings. `Completed`
10. Frontend checks and E2E smoke if practical. `Partially completed`

## Notification Center Implementation Order

1. Add `notification_events` model and Alembic migration. `Completed`
2. Add notification schemas/repository/service. `Completed`
3. Add `/me/notifications` endpoints. `Completed`
4. Emit invite accepted/declined notifications. `Completed`
5. Add backend tests for notification creation and scoping. `Completed`
6. Add frontend notification API, query keys, and hooks. `Completed`
7. Upgrade bell to open a notification center with action-required and updates. `Completed`
8. Add `notifications` i18n namespace. `Completed`
9. Add frontend checks and targeted UI tests if practical. `Completed`

## Current Implementation Notes

- Pending invites use `score_invites` as the source of truth.
- `/api/v1/me/invites` returns only active pending invites addressed to the signed-in user's email.
- `/api/v1/me/invites/{invite_id}/accept` reuses the same membership creation and role-upgrade logic as token-based invite acceptance.
- `/api/v1/me/invites/{invite_id}/decline` marks the invite as `DECLINED` and stores `declined_at`.
- The frontend account menu shows a count badge when pending invites exist.
- The account menu opens `PendingInvitesDialog`, where users can accept or decline invites.
- The top navigation notification bell opens `NotificationCenterDialog`.
- The bell badge combines pending invite count and unread notification count.
- `notification_events` stores user-facing updates such as invite acceptance and invite decline.
- `/api/v1/me/notifications` exposes notification list, unread count, mark-read, and mark-all-read.
- Mark-read and mark-all-read use optimistic cache updates so the notification item and bell badge respond immediately.
- The notification center Updates section supports `All` and `Unread` filters.
- Updates are grouped by local date (`Today`, `Yesterday`, `Earlier`) to keep dense notification lists scannable.
- The notification center has section-level error states and retry actions for pending invites and update notifications.
- `notification_events.dedupe_key` prevents duplicate notification rows when retryable domain outcomes are emitted more than once.
- Notification cleanup is exposed through `NotificationService.cleanup_expired_events()` for service-level use and `NotificationMaintenanceService` for Celery Beat.
- Celery Beat runs `app.worker.tasks.run_notification_maintenance` every `NOTIFICATION_CLEANUP_INTERVAL_SECONDS`, currently defaulting to 24 hours.
- Notification retention uses `NOTIFICATION_RETENTION_DAYS`, currently defaulting to 90 days.
- Accepting or declining a pending invite creates a best-effort notification for the inviter.
- Saving a new score revision creates best-effort `score.version.created` notifications for the score owner and active members, excluding the actor.
- Import completion creates a best-effort `import.completed` notification for the job owner.
- Import failure creates a best-effort `import.failed` notification for the job owner.
- Clicking an `import.completed` notification routes to `/review/{job_id}`.
- Clicking an `import.failed` notification routes to `/upload?job_id={job_id}`, matching the failed-job behavior on `/my-scores`.
- Accepting a pending invite redirects to `/score/:id`.

## Remaining Follow-Ups

- Add an authenticated integration or backend API test for the full HTTP flow once test-user/session helpers are available.
- Consider a dedicated `/invitations` page only if users commonly have long invite lists.
- Add future notification producers for comments and publication changes.
- Keep full event stream/activity feed out of scope until multiple projections need it.

## Verification Commands

Backend:

```bash
docker compose -f docker-compose.backend-dev.yml run --rm api alembic upgrade head
docker compose -f docker-compose.backend-dev.yml run --rm api ruff check app/modules/notifications app/modules/score_invites app/db/models/notification.py app/db/models/__init__.py app/api/v1/router.py app/shared/constants.py tests/test_score_revision_services.py
docker compose -f docker-compose.backend-dev.yml run --rm api ruff check app/modules/notifications app/modules/revisions tests/test_score_revision_services.py
docker compose -f docker-compose.backend-dev.yml run --rm api pytest tests/test_score_revision_services.py -q
```

Frontend:

```bash
cd frontend
npm run typecheck
npm run lint
npm run test:unit -- tests/unit/notification-queries.test.ts tests/unit/score-collaboration.test.ts tests/unit/query-client.test.ts
npm run test:e2e -- tests/e2e/notification-center.spec.ts
```
