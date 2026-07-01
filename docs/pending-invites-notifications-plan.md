# Pending Invites And Notifications Plan

This document defines the next collaboration-notification step after email invites. The goal is to let an invited user see and accept collaboration invites inside the app, even if they never open the email.

## Current State

- Collaboration invite records already live in `score_invites`.
- Invite acceptance already works through `/invite/:token`.
- Invite records are email-targeted.
- Email delivery is useful but not reliable enough to be the only user-facing channel.
- The app has no persisted in-app notification table yet.

## Product Direction

Recommended rollout order:

1. Add a user-facing "Pending invites" surface.
2. Add a lightweight nav indicator/count.
3. Later evolve into a general notification center.
4. Defer real-time push/WebSocket until collaboration activity becomes dense.

This keeps the MVP focused and avoids building a full message center before the product actually needs one.

## Non-Goals For This Phase

- No generic `notifications` table.
- No read/unread state.
- No browser push notifications.
- No WebSocket or real-time presence.
- No invite comments/activity feed.
- No cross-resource notification framework.

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

## Open Decisions

### Should invite creation create a notification record now?

Not in this phase.

Reason:

- `score_invites` already is the pending invite source of truth.
- A separate notification row would duplicate state before we need read/unread behavior.
- We can introduce `notifications` later and backfill from invite events if necessary.

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

## Current Implementation Notes

- Pending invites use `score_invites` as the source of truth.
- `/api/v1/me/invites` returns only active pending invites addressed to the signed-in user's email.
- `/api/v1/me/invites/{invite_id}/accept` reuses the same membership creation and role-upgrade logic as token-based invite acceptance.
- `/api/v1/me/invites/{invite_id}/decline` marks the invite as `DECLINED` and stores `declined_at`.
- The frontend account menu shows a count badge when pending invites exist.
- The account menu opens `PendingInvitesDialog`, where users can accept or decline invites.
- Accepting a pending invite redirects to `/score/:id`.

## Remaining Follow-Ups

- Run backend Docker migration and pytest once Docker Desktop is available.
- Add an E2E flow for user B logging in, seeing the pending invite count, accepting, and landing on `/score/:id`.
- Consider a dedicated `/invitations` page only if users commonly have long invite lists.
- Introduce a generic `notifications` table only after there are multiple notification types beyond collaboration invites.

## Verification Commands

Backend:

```bash
docker compose -f docker-compose.backend-dev.yml run --rm api alembic upgrade head
docker compose -f docker-compose.backend-dev.yml run --rm api python -m ruff check app/modules/score_invites app/db/models/score_access.py tests
docker compose -f docker-compose.backend-dev.yml run --rm api pytest tests/test_score_revision_services.py tests/test_api_smoke.py
```

Frontend:

```bash
cd frontend
npm run typecheck
npm run lint
```
