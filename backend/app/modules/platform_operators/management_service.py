"""Operator lifecycle changes with serialized administrator continuity and atomic audits."""

from sqlalchemy import select, update, delete, text, func
from sqlalchemy.orm import Session
from app.db.models import Operator, OperatorSession, OperatorMfaChallenge, OperatorRecoveryCode
from app.modules.platform_operators.domain import OperatorRole, OperatorStatus
from app.modules.platform_operators.service import AuditContext
from app.modules.ops.audit_service import OpsAuditService
from app.platform.security.passwords import hash_password, validate_password
from app.core.exceptions import AppException, UnauthorizedException, ResourceNotFoundException
from app.core.control_plane_errors import ControlPlaneErrorCode
from app.shared.time import utc_now


def create_operator(
    db: Session, *, email: str, password: str, display_name: str, role: OperatorRole
) -> Operator:
    from pydantic import TypeAdapter, EmailStr

    normalized = str(TypeAdapter(EmailStr).validate_python(email)).lower()
    if db.scalar(select(Operator.id).where(Operator.email == normalized)):
        raise AppException(code=ControlPlaneErrorCode.VALIDATION_ERROR, status_code=409)
    operator = Operator(
        email=normalized,
        password_hash=hash_password(validate_password(password)),
        display_name=display_name.strip(),
        role=role,
    )
    db.add(operator)
    db.flush()
    return operator


def lock_administrator(db: Session, actor_id: int) -> Operator:
    db.execute(text("SELECT pg_advisory_xact_lock(783961422)"))
    actor = db.scalar(
        select(Operator)
        .where(Operator.id == actor_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if (
        actor is None
        or actor.status != OperatorStatus.ACTIVE
        or actor.role != OperatorRole.SUPER_ADMIN
        or actor.totp_enabled_at is None
    ):
        raise UnauthorizedException(code=ControlPlaneErrorCode.NO_ACCESS)
    return actor


def revoke_operator_access(db: Session, operator_id: int) -> None:
    now = utc_now()
    db.execute(
        update(OperatorSession)
        .where(OperatorSession.operator_id == operator_id, OperatorSession.revoked_at.is_(None))
        .values(revoked_at=now)
    )
    db.execute(
        update(OperatorMfaChallenge)
        .where(
            OperatorMfaChallenge.operator_id == operator_id,
            OperatorMfaChallenge.consumed_at.is_(None),
        )
        .values(consumed_at=now, pending_secret_encrypted=None)
    )


def audit_management(
    db: Session,
    actor_id: int,
    action: str,
    target_type: str,
    target_id: str,
    reason: str,
    context: AuditContext,
    **facts,
) -> None:
    OpsAuditService().record_event(
        db,
        actor_operator_id=actor_id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        reason=reason,
        outcome="succeeded",
        ip_address=context.ip_address,
        user_agent=context.user_agent,
        request_id=context.request_id,
        **facts,
    )


def manage_operator(
    db: Session,
    *,
    actor_id: int,
    operator_uuid: str,
    action: str,
    reason: str,
    context: AuditContext,
    role: OperatorRole | None = None,
    status: OperatorStatus | None = None,
    password: str | None = None,
) -> Operator:
    lock_administrator(db, actor_id)
    target = db.scalar(
        select(Operator)
        .where(Operator.operator_uuid == operator_uuid)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if target is None:
        raise ResourceNotFoundException("operator", code=ControlPlaneErrorCode.RESOURCE_NOT_FOUND)
    previous = {
        "role": target.role.value,
        "status": target.status.value,
        "totp_enabled": target.totp_enabled_at is not None,
    }
    if action == "operator.update":
        assert role is not None and status is not None
        if (
            target.role == OperatorRole.SUPER_ADMIN
            and target.status == OperatorStatus.ACTIVE
            and (role != OperatorRole.SUPER_ADMIN or status != OperatorStatus.ACTIVE)
        ):
            count = db.scalar(
                select(func.count())
                .select_from(Operator)
                .where(
                    Operator.role == OperatorRole.SUPER_ADMIN,
                    Operator.status == OperatorStatus.ACTIVE,
                )
            )
            if count == 1:
                raise AppException(code=ControlPlaneErrorCode.NO_ACCESS, status_code=409)
        target.role = role
        target.status = status
    elif action == "operator.mfa_reset":
        target.totp_secret_encrypted = None
        target.totp_enabled_at = None
        target.totp_last_used_step = None
        db.execute(
            delete(OperatorRecoveryCode).where(OperatorRecoveryCode.operator_id == target.id)
        )
    elif action == "operator.password_reset":
        assert password is not None
        target.password_hash = hash_password(validate_password(password))
    else:
        raise ValueError("Unknown operator management action")
    revoke_operator_access(db, target.id)
    audit_management(
        db,
        actor_id,
        action,
        "operator",
        target.operator_uuid,
        reason,
        context,
        metadata_json={
            "before": previous,
            "after": {
                "role": target.role.value,
                "status": target.status.value,
                "totp_enabled": target.totp_enabled_at is not None,
            },
        },
    )
    db.flush()
    return target
