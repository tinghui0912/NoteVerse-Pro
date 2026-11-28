"""Consumer session issuance, authoritative validation and revocation."""

from datetime import timedelta
from uuid import UUID
import re
from sqlalchemy import event, select, update
from sqlalchemy.orm import Session, sessionmaker
from app.platform.config.application import CustomerAuthConfig
from app.platform.security.opaque_tokens import generate_token, token_digest, matches_digest
from app.db.models import User, UserSession
from app.modules.auth.session_states import SessionRevocationReason as Reason
from app.modules.auth.session_cache import SessionCache, SessionHint
from app.modules.auth.schemas import SessionSummary
from app.modules.auth.credential_lifecycle import lock_credential_user
from app.core.exceptions import AuthenticationException, ResourceNotFoundException
from app.shared.error_codes import CustomerErrorCode
from app.shared.time import utc_now

_EVICTIONS = "consumer_session_evictions"


@event.listens_for(Session, "after_commit")
def _evict_committed_sessions(db: Session) -> None:
    if db.in_nested_transaction():
        return
    for cache, digests in db.info.pop(_EVICTIONS, []):
        cache.evict(digests)


@event.listens_for(Session, "after_soft_rollback")
def _discard_rolled_back_evictions(db: Session, transaction) -> None:
    if transaction.parent is None:
        db.info.pop(_EVICTIONS, None)


class SessionService:
    def __init__(
        self,
        *,
        config: CustomerAuthConfig,
        cache: SessionCache | None = None,
        sessions: sessionmaker[Session] | None = None,
    ) -> None:
        self.config, self.cache, self.sessions = config, cache, sessions

    def create_session(
        self,
        db: Session,
        user_id: int,
        *,
        user_agent: str | None = None,
        ip_address: str | None = None,
    ) -> tuple[str, UserSession]:
        user = db.scalar(
            select(User)
            .where(User.id == user_id)
            .with_for_update(key_share=True)
            .execution_options(populate_existing=True)
        )
        if user is None or not user.is_active or user.deleted_at is not None:
            raise AuthenticationException(code=CustomerErrorCode.TOKEN_INVALID_EXPIRED)
        now = utc_now()
        token = generate_token()
        absolute = now + timedelta(days=self.config.SESSION_ABSOLUTE_DAYS)
        row = UserSession(
            user_id=user_id,
            token_hash=token_digest(token),
            created_at=now,
            last_seen_at=now,
            idle_expires_at=min(absolute, now + timedelta(days=self.config.SESSION_IDLE_DAYS)),
            absolute_expires_at=absolute,
            user_agent=user_agent[:512] if user_agent else None,
            ip_address=ip_address[:64] if ip_address else None,
        )
        db.add(row)
        db.flush()
        return token, row

    def authenticate(self, db: Session, token: str) -> tuple[User, UUID]:
        if re.fullmatch(r"[A-Za-z0-9_-]{43}", token) is None:
            raise AuthenticationException(code=CustomerErrorCode.TOKEN_INVALID_EXPIRED)
        digest, now = token_digest(token), utc_now()
        hint = self.cache.read(digest) if self.cache else None
        query = (
            select(UserSession, User)
            .join(User, User.id == UserSession.user_id)
            .where(
                UserSession.token_hash == digest,
                UserSession.revoked_at.is_(None),
                UserSession.idle_expires_at > now,
                UserSession.absolute_expires_at > now,
                User.is_active.is_(True),
                User.deleted_at.is_(None),
            )
        )
        if hint is not None:
            query = query.where(
                UserSession.id == hint.session_id, UserSession.user_id == hint.user_id
            )
        result = db.execute(query.execution_options(populate_existing=True)).first()
        if result is None:
            raise AuthenticationException(code=CustomerErrorCode.TOKEN_INVALID_EXPIRED)
        row, user = result
        if self.cache:
            self.cache.remember(
                digest,
                SessionHint(row.id, row.user_id),
                remaining_seconds=int(
                    (min(row.idle_expires_at, row.absolute_expires_at) - now).total_seconds()
                ),
            )
        if (
            row.last_seen_at <= now - timedelta(seconds=self.config.SESSION_TOUCH_INTERVAL_SECONDS)
            and self.sessions is not None
        ):
            with self.sessions.begin() as touch:
                touch.execute(
                    update(UserSession)
                    .where(
                        UserSession.id == row.id,
                        UserSession.revoked_at.is_(None),
                        UserSession.idle_expires_at > now,
                        UserSession.absolute_expires_at > now,
                        UserSession.last_seen_at
                        <= now - timedelta(seconds=self.config.SESSION_TOUCH_INTERVAL_SECONDS),
                    )
                    .values(
                        last_seen_at=now,
                        idle_expires_at=min(
                            row.absolute_expires_at,
                            now + timedelta(days=self.config.SESSION_IDLE_DAYS),
                        ),
                    )
                )
        return user, row.id

    def _revoke(self, db: Session, predicate, *, reason: Reason, now=None) -> None:
        digests = list(
            db.scalars(
                update(UserSession)
                .where(predicate, UserSession.revoked_at.is_(None))
                .values(revoked_at=now or utc_now(), revoked_reason=reason)
                .returning(UserSession.token_hash)
            )
        )
        if self.cache and digests:
            db.info.setdefault(_EVICTIONS, []).append((self.cache, digests))

    def revoke_session(self, db: Session, token: str | None) -> None:
        if token:
            self._revoke(db, UserSession.token_hash == token_digest(token), reason=Reason.LOGOUT)
            db.commit()

    def revoke_user_sessions(
        self, db: Session, user_id: int, *, reason: Reason, revoked_at=None, commit: bool = True
    ) -> None:
        self._revoke(db, UserSession.user_id == user_id, reason=reason, now=revoked_at)
        if commit:
            db.commit()

    def list_user_sessions(
        self, db: Session, user_id: int, *, current_token: str | None = None, limit: int = 100
    ) -> list[SessionSummary]:
        now = utc_now()
        rows = db.scalars(
            select(UserSession)
            .where(
                UserSession.user_id == user_id,
                UserSession.revoked_at.is_(None),
                UserSession.idle_expires_at > now,
                UserSession.absolute_expires_at > now,
            )
            .order_by(UserSession.created_at.desc())
            .limit(limit)
        )
        return [
            SessionSummary(
                id=row.id,
                user_agent=row.user_agent,
                ip_address=row.ip_address,
                created_at=row.created_at,
                last_seen_at=row.last_seen_at,
                idle_expires_at=row.idle_expires_at,
                absolute_expires_at=row.absolute_expires_at,
                is_current=bool(current_token and matches_digest(current_token, row.token_hash)),
            )
            for row in rows
        ]

    def revoke_user_session(
        self, db: Session, user_id: int, session_id: UUID, *, current_token: str | None = None
    ) -> bool:
        row = db.scalar(
            select(UserSession).where(UserSession.id == session_id, UserSession.user_id == user_id)
        )
        if row is None:
            raise ResourceNotFoundException(resource_type="session", resource_id=str(session_id))
        current = bool(current_token and matches_digest(current_token, row.token_hash))
        self._revoke(db, UserSession.id == row.id, reason=Reason.DEVICE_REVOKED)
        db.commit()
        return current

    def revoke_other_user_sessions(
        self, db: Session, user_id: int, *, current_token: str | None
    ) -> None:
        if not current_token:
            raise AuthenticationException(code=CustomerErrorCode.TOKEN_INVALID_EXPIRED)
        lock_credential_user(db, user_id)
        user, _ = self.authenticate(db, current_token)
        if user.id != user_id:
            raise AuthenticationException(code=CustomerErrorCode.TOKEN_INVALID_EXPIRED)
        self._revoke(
            db,
            (UserSession.user_id == user_id)
            & (UserSession.token_hash != token_digest(current_token)),
            reason=Reason.OTHER_SESSIONS,
        )
        db.commit()
