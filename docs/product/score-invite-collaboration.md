# Score Invite Collaboration

## Status

MVP implemented.

This document records the implemented collaboration-invite architecture and the remaining backlog. It is no longer a speculative migration plan.

## Product Semantics

`Score` is the durable product resource.

Access entries are intentionally separate:

- `/share/:token` is a lightweight bearer access link for view/download/practice according to grant flags.
- `/invite/:token` is an authenticated membership acceptance link.
- Editing capability comes from ownership or `ScoreMembership`, never from a public/share token.

## Implemented Flow

```text
Owner opens /score/:id
  -> creates collaboration invite
  -> frontend receives raw opaque token once
  -> collaborator opens /invite/:token
  -> invite summary is shown
  -> unauthenticated user logs in with returnUrl=/invite/:token?accept=1
  -> or registers while preserving the same returnUrl
  -> invite access is refreshed after login
  -> invite is accepted
  -> ScoreMembership is created/restored/upgraded
  -> collaborator is redirected to /score/:id
```

## Token Design

Invite and share links both use single-segment opaque `base64url` tokens.

```text
/invite/opaque_token
/share/opaque_token
```

Rules:

- Raw tokens are returned only at creation time.
- The database stores only `sha256(token)`.
- Business identifiers remain in database records, not in URLs.
- Tokens do not include `.` path separators.
- URL routing is just an entry mechanism; backend records remain the source of truth.

## Backend

Implemented module:

```text
backend/app/modules/score_invites/
  __init__.py
  dependencies.py
  repository.py
  router.py
  schemas.py
  service.py
```

Implemented data model:

```text
score_invites
  id
  invite_uuid
  score_id
  token_hash
  email
  role
  status
  created_by_user_id
  accepted_by_user_id
  created_at
  expires_at
  accepted_at
  revoked_at
```

Implemented enum:

```text
InviteStatus
  PENDING
  ACCEPTED
  REVOKED
  EXPIRED
```

Implemented capability:

```text
ScoreAction.MANAGE_MEMBERS
ScoreCapabilities.can_manage_members
```

Implemented APIs:

```text
GET    /api/v1/scores/{score_id}/invites
POST   /api/v1/scores/{score_id}/invites
POST   /api/v1/scores/{score_id}/invites/{invite_id}/revoke
DELETE /api/v1/scores/{score_id}/invites/{invite_id}

GET    /api/v1/scores/{score_id}/members
PATCH  /api/v1/scores/{score_id}/members/{membership_id}
DELETE /api/v1/scores/{score_id}/members/{membership_id}

GET    /api/v1/invites/{token}
POST   /api/v1/invites/{token}/accept
```

Acceptance behavior:

- Requires an authenticated user.
- Rejects missing, expired, revoked, or already accepted invites.
- Enforces email match for every invite. Collaboration invites are email-targeted; anonymous or bearer-token access belongs to the share-link flow.
- Creates `ScoreMembership` when absent.
- Restores revoked membership for the same user.
- Upgrades membership role when invite grants a stronger role.
- Never downgrades existing membership through invite acceptance.

## Frontend

Implemented route:

```text
frontend/src/app/[locale]/invite/[token]/page.tsx
```

Implemented collaboration UI:

```text
frontend/src/components/score-detail/score-collaboration-dialog.tsx
```

Implemented frontend API and hooks:

```text
frontend/src/lib/api/score-invites.ts
frontend/src/hooks/queries/use-score-queries.ts
frontend/src/lib/query-client.ts
frontend/src/types/api/scores.ts
```

Implemented i18n:

```text
frontend/messages/zh/scoreCollaboration.json
frontend/messages/en/scoreCollaboration.json
frontend/messages/zh/errors.json
frontend/messages/en/errors.json
```

UI boundaries:

- `ScoreShareDialog` remains view-only/share-link management.
- `ScoreCollaborationDialog` owns members and collaboration invites.
- `ScoreActions` shows collaboration only when `can_manage_members` is true.
- `/invite/:token` is public as an entry route, but accepting requires login.

## Verified

```bash
cd frontend
npm run typecheck
npm run lint
npm run test:unit -- tests/unit/query-client.test.ts

cd ..
docker compose -f docker-compose.backend-dev.yml run --rm api alembic upgrade head
docker compose -f docker-compose.backend-dev.yml run --rm api python -m ruff check app/modules/score_invites app/modules/score_access app/modules/score_sharing app/db/models/score_access.py app/api/v1/router.py tests/test_score_revision_services.py tests/test_api_smoke.py
docker compose -f docker-compose.backend-dev.yml run --rm api pytest tests/test_score_revision_services.py tests/test_api_smoke.py
```

Latest manual validation:

- Owner creates invite.
- Another account opens invite link.
- Login returns to `/invite/:token?accept=1`.
- Login-to-register preserves the invite returnUrl.
- Invite is accepted automatically.
- User lands on `/score/:id`.
- Editor member can edit.
- Targeted email invites enqueue a localized transactional invitation email.
- Invitation emails include plain-text and HTML bodies.

## Non-Goals

- No real-time collaborative editing.
- No CRDT or operational transform.
- No public/share token editing.
- No route compatibility aliases.
- No invite decline endpoint in MVP.

## Email Delivery

Implemented behavior:

- `POST /api/v1/scores/{score_id}/invites` requires a collaborator email and enqueues an invitation email through the shared `dispatch_email()` boundary.
- Link-only collaboration invites are intentionally not supported. Use score sharing for anonymous or restricted link access.
- Email dispatch is best-effort after the invite record is committed; a mail queue failure is logged and does not roll back the invite.
- The invite URL is built from `FRONTEND_BASE_URL`. This setting is required because email clients need an absolute public frontend URL.
- The backend supports localized Chinese and English invite content through the `locale` field on the create-invite request.

Email provider:

- Invite email is sent through the Resend HTTP API.
- `MAIL_DEFAULT_SENDER` must be a product-owned sender identity, for example `NoteVerse Pro <no-reply@noteverse.example>`.
- 4xx provider responses are treated as permanent delivery failures and are not retried by the worker.

Authentication verification emails use the same `dispatch_email()` boundary:

- Registration codes are valid for `EMAIL_REGISTER_CODE_TTL_SECONDS` seconds. The default is 600 seconds.
- Password reset codes are valid for `EMAIL_PASSWORD_RESET_CODE_TTL_SECONDS` seconds. The default is 300 seconds.
- After a code is verified, the follow-up registration/reset JWT is valid for `EMAIL_VERIFY_TOKEN_MAX_AGE_SECONDS` seconds. The default is 900 seconds.
- Resending is throttled by `EMAIL_CODE_COOLDOWN_SECONDS`. The default is 60 seconds.
- A challenge is invalidated after `EMAIL_CODE_MAX_ATTEMPTS` failed verification attempts. The default is 5 attempts.
- Verification emails include localized plain-text and HTML bodies.

Development can use a sandbox sender, but production should not use a personal mailbox.

Recommended production setup:

- Use a transactional email provider, such as Resend, AWS SES, SendGrid, Postmark, Mailgun, or a regional equivalent.
- Send from a product-owned domain, for example `no-reply@noteverse.example`.
- Configure SPF, DKIM, and DMARC for that domain.
- Keep marketing email separate from transactional email.
- Monitor delivery, bounces, complaints, and suppression lists.
- Use provider API keys stored in a secret manager, not personal mailbox passwords.

## Backlog

Recommended next work:

- Add component tests for `ScoreCollaborationDialog`.
- Add an owner/member E2E flow once auth fixtures are stable.
- Add component tests for invite email rendering if the template grows.
- Consider a dedicated collaboration activity log if audit requirements grow.

Deferred intentionally:

- `POST /api/v1/invites/{token}/decline`
- Real-time presence
- Conflict resolution beyond existing revision/version handling
