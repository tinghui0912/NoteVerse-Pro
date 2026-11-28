"""Password challenges, mandatory MFA and authoritative operator sessions."""

from dataclasses import dataclass
from datetime import timedelta
from sqlalchemy import select, update, func
from sqlalchemy.orm import Session
from app.platform.config.operator_session import OperatorSessionConfig
from app.platform.security.passwords import verify_password
from app.platform.security.opaque_tokens import generate_token, token_digest
from app.platform.security import totp
from app.db.models import Operator, OperatorSession, OperatorMfaChallenge, OperatorRecoveryCode
from app.modules.platform_operators.domain import OperatorStatus, ChallengePurpose
from app.modules.ops.audit_service import OpsAuditService
from app.core.exceptions import AuthenticationException
from app.core.control_plane_errors import ControlPlaneErrorCode
from app.shared.time import utc_now


@dataclass(frozen=True)
class AuditContext:
    ip_address: str | None = None
    user_agent: str | None = None
    request_id: str | None = None


def record_auth_event(
    db: Session,
    operator: Operator | None,
    action: str,
    context: AuditContext,
    *,
    succeeded: bool = True,
) -> None:
    OpsAuditService().record_event(
        db,
        actor_operator_id=operator.id if operator else None,
        action=action,
        target_type="operator",
        target_id=operator.operator_uuid if operator else "unknown",
        reason=action.replace(".", " "),
        outcome="succeeded" if succeeded else "failed",
        ip_address=context.ip_address,
        user_agent=context.user_agent,
        request_id=context.request_id,
    )


class OperatorAuthenticationService:
    def __init__(self, config: OperatorSessionConfig):
        self.config = config

    def _reject(self, db, operator, action, context):
        record_auth_event(db, operator, action, context, succeeded=False)
        raise AuthenticationException(code=ControlPlaneErrorCode.INVALID_CREDENTIALS)

    def start_login(
        self, db: Session, *, email: str, password: str, context: AuditContext
    ) -> tuple[str, OperatorMfaChallenge]:
        operator = db.scalar(
            select(Operator).where(Operator.email == email.strip().lower()).with_for_update()
        )
        if (
            operator is None
            or operator.status != OperatorStatus.ACTIVE
            or not verify_password(password, operator.password_hash)
        ):
            self._reject(db, operator, "auth.login_failed", context)
        now = utc_now()
        db.execute(
            update(OperatorMfaChallenge)
            .where(
                OperatorMfaChallenge.operator_id == operator.id,
                OperatorMfaChallenge.consumed_at.is_(None),
            )
            .values(consumed_at=now, pending_secret_encrypted=None)
        )
        token = generate_token()
        challenge = OperatorMfaChallenge(
            operator_id=operator.id,
            token_hash=token_digest(token),
            purpose=ChallengePurpose.VERIFICATION_REQUIRED
            if operator.totp_enabled_at
            else ChallengePurpose.ENROLLMENT_REQUIRED,
            expires_at=now + timedelta(minutes=5),
        )
        db.add(challenge)
        record_auth_event(db, operator, "auth.password_verified", context)
        db.flush()
        return token, challenge

    def _challenge(
        self, db: Session, token: str | None, purpose: ChallengePurpose, context: AuditContext
    ) -> tuple[Operator, OperatorMfaChallenge]:
        candidate = db.scalar(
            select(OperatorMfaChallenge.operator_id).where(
                OperatorMfaChallenge.token_hash == token_digest(token or "")
            )
        )
        operator = (
            db.scalar(
                select(Operator)
                .where(Operator.id == candidate)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            if candidate
            else None
        )
        challenge = db.scalar(
            select(OperatorMfaChallenge)
            .where(OperatorMfaChallenge.token_hash == token_digest(token or ""))
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if (
            operator is None
            or operator.status != OperatorStatus.ACTIVE
            or challenge is None
            or challenge.purpose != purpose
            or challenge.consumed_at is not None
            or challenge.expires_at <= utc_now()
            or challenge.attempt_count >= 5
            or bool(operator.totp_enabled_at) != (purpose == ChallengePurpose.VERIFICATION_REQUIRED)
        ):
            self._reject(db, operator, "auth.mfa_failed", context)
        return operator, challenge

    def start_enrollment(
        self, db: Session, token: str | None, context: AuditContext
    ) -> tuple[str, str]:
        operator, challenge = self._challenge(
            db, token, ChallengePurpose.ENROLLMENT_REQUIRED, context
        )
        secret = totp.generate_secret()
        challenge.pending_secret_encrypted = totp.encrypt_secret(self.config.encryption_key, secret)
        record_auth_event(db, operator, "auth.mfa_enrollment_started", context)
        return secret, totp.provisioning_uri(secret, operator.email)

    def _code(self, operator: Operator, ciphertext: str | None, code: str) -> int | None:
        if ciphertext is None:
            return None
        secret = totp.decrypt_secret(self.config.encryption_key, ciphertext)
        return totp.verify_code(
            secret,
            code,
            timestamp=utc_now().timestamp(),
            last_used_step=operator.totp_last_used_step,
        )

    def _finish(
        self,
        db: Session,
        operator: Operator,
        challenge: OperatorMfaChallenge,
        context: AuditContext,
    ) -> str:
        now = utc_now()
        challenge.consumed_at = now
        challenge.pending_secret_encrypted = None
        token = generate_token()
        db.add(
            OperatorSession(
                operator_id=operator.id,
                token_hash=token_digest(token),
                created_at=now,
                last_seen_at=now,
                idle_expires_at=now + timedelta(hours=2),
                absolute_expires_at=now + timedelta(hours=12),
                ip_address=context.ip_address,
                user_agent=context.user_agent,
            )
        )
        db.flush()
        return token

    def confirm_enrollment(
        self, db: Session, token: str | None, code: str, context: AuditContext
    ) -> tuple[Operator, str, tuple[str, ...]]:
        operator, challenge = self._challenge(
            db, token, ChallengePurpose.ENROLLMENT_REQUIRED, context
        )
        step = self._code(operator, challenge.pending_secret_encrypted, code)
        if step is None:
            challenge.attempt_count += 1
            self._reject(db, operator, "auth.mfa_failed", context)
        operator.totp_secret_encrypted = challenge.pending_secret_encrypted
        operator.totp_enabled_at = utc_now()
        operator.totp_last_used_step = step
        codes = totp.generate_recovery_codes()
        db.add_all(
            OperatorRecoveryCode(operator_id=operator.id, code_hash=token_digest(value))
            for value in codes
        )
        session = self._finish(db, operator, challenge, context)
        record_auth_event(db, operator, "auth.mfa_enrolled", context)
        return operator, session, codes

    def verify_mfa(
        self,
        db: Session,
        token: str | None,
        *,
        code: str | None,
        recovery_code: str | None,
        context: AuditContext,
    ) -> tuple[Operator, str, int]:
        operator, challenge = self._challenge(
            db, token, ChallengePurpose.VERIFICATION_REQUIRED, context
        )
        if recovery_code is not None:
            consumed = db.scalar(
                update(OperatorRecoveryCode)
                .where(
                    OperatorRecoveryCode.operator_id == operator.id,
                    OperatorRecoveryCode.code_hash == token_digest(recovery_code.upper()),
                    OperatorRecoveryCode.consumed_at.is_(None),
                )
                .values(consumed_at=utc_now())
                .returning(OperatorRecoveryCode.id)
            )
            valid = consumed is not None
        else:
            step = self._code(operator, operator.totp_secret_encrypted, code or "")
            valid = step is not None
            if valid:
                operator.totp_last_used_step = step
        if not valid:
            challenge.attempt_count += 1
            self._reject(db, operator, "auth.mfa_failed", context)
        raw = self._finish(db, operator, challenge, context)
        record_auth_event(db, operator, "auth.mfa_verified", context)
        if recovery_code is not None:
            record_auth_event(db, operator, "auth.recovery_code_consumed", context)
        remaining = db.scalar(
            select(func.count())
            .select_from(OperatorRecoveryCode)
            .where(
                OperatorRecoveryCode.operator_id == operator.id,
                OperatorRecoveryCode.consumed_at.is_(None),
            )
        )
        return operator, raw, remaining

    def resolve_session(self, db: Session, *, token: str) -> tuple[Operator, OperatorSession]:
        now = utc_now()
        result = db.execute(
            select(Operator, OperatorSession)
            .join(OperatorSession, Operator.id == OperatorSession.operator_id)
            .where(
                OperatorSession.token_hash == token_digest(token),
                OperatorSession.revoked_at.is_(None),
                OperatorSession.idle_expires_at > now,
                OperatorSession.absolute_expires_at > now,
                Operator.status == OperatorStatus.ACTIVE,
                Operator.totp_enabled_at.is_not(None),
            )
        ).first()
        if result is None:
            raise AuthenticationException(code=ControlPlaneErrorCode.TOKEN_INVALID_EXPIRED)
        operator, session = result
        if session.last_seen_at <= now - timedelta(minutes=5):
            db.execute(
                update(OperatorSession)
                .where(
                    OperatorSession.id == session.id,
                    OperatorSession.revoked_at.is_(None),
                    OperatorSession.idle_expires_at > now,
                    OperatorSession.absolute_expires_at > now,
                    OperatorSession.last_seen_at <= now - timedelta(minutes=5),
                )
                .values(
                    last_seen_at=now,
                    idle_expires_at=min(now + timedelta(hours=2), session.absolute_expires_at),
                )
            )
        return operator, session

    def revoke_session(self, db: Session, *, token: str | None, context: AuditContext) -> None:
        digest = token_digest(token or "")
        operator_id = db.scalar(
            select(OperatorSession.operator_id).where(OperatorSession.token_hash == digest)
        )
        if operator_id is None:
            return
        operator = db.scalar(select(Operator).where(Operator.id == operator_id).with_for_update())
        if operator is None:
            return
        session = db.scalar(
            select(OperatorSession)
            .where(OperatorSession.token_hash == digest, OperatorSession.operator_id == operator_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if session is not None:
            if session.revoked_at is None:
                session.revoked_at = utc_now()
            record_auth_event(db, operator, "auth.logout", context)
