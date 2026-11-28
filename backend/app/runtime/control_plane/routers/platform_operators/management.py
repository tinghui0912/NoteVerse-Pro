"""Permission-gated operator lifecycle and customer status commands."""

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import select, text
from sqlalchemy.orm import Session
from app.core.exceptions import ResourceNotFoundException
from app.core.control_plane_errors import ControlPlaneErrorCode
from app.db.models import Operator
from app.platform.db.dependencies import get_db
from app.runtime.control_plane.deps import OperatorPrincipal, require_permission
from app.runtime.control_plane.routers.platform_operators.router import audit_context
from app.modules.platform_operators.permissions import OperatorPermission
from app.modules.platform_operators.schemas import (
    OperatorRead,
    CreateOperatorCommand,
    UpdateOperatorCommand,
    ResetOperatorPasswordCommand,
    CustomerStatusCommand,
    CustomerDirectoryRead,
    operator_read,
)
from app.modules.ops.schemas import ReasonCommand
from app.modules.platform_operators.management_service import (
    create_operator,
    lock_administrator,
    manage_operator,
    audit_management,
)
from app.shared.pagination import OffsetPage

router = APIRouter()


@router.get("/operators", response_model=OffsetPage[OperatorRead], operation_id="operatorsList")
def list_operators(
    _actor: OperatorPrincipal = Depends(require_permission(OperatorPermission.OPERATORS_MANAGE)),
    db: Session = Depends(get_db, scope="function"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0, le=10000),
):
    rows = db.scalars(select(Operator).order_by(Operator.id).offset(offset).limit(limit + 1)).all()
    return OffsetPage(
        items=[operator_read(row) for row in rows[:limit]],
        limit=limit,
        offset=offset,
        has_more=len(rows) > limit,
    )


@router.post(
    "/operators", response_model=OperatorRead, status_code=201, operation_id="operatorCreate"
)
def add_operator(
    command: CreateOperatorCommand,
    request: Request,
    actor: OperatorPrincipal = Depends(require_permission(OperatorPermission.OPERATORS_MANAGE)),
    db: Session = Depends(get_db, scope="function"),
):
    lock_administrator(db, actor.operator.id)
    row = create_operator(
        db,
        email=str(command.email),
        password=command.password,
        display_name=command.display_name,
        role=command.role,
    )
    audit_management(
        db,
        actor.operator.id,
        "operator.create",
        "operator",
        row.operator_uuid,
        command.reason,
        audit_context(request),
        metadata_json={"role": row.role.value, "status": row.status.value, "totp_enabled": False},
    )
    db.commit()
    return operator_read(row)


@router.patch(
    "/operators/{operator_id}", response_model=OperatorRead, operation_id="operatorUpdate"
)
def update_operator(
    operator_id: str,
    command: UpdateOperatorCommand,
    request: Request,
    actor: OperatorPrincipal = Depends(require_permission(OperatorPermission.OPERATORS_MANAGE)),
    db: Session = Depends(get_db, scope="function"),
):
    row = manage_operator(
        db,
        actor_id=actor.operator.id,
        operator_uuid=operator_id,
        action="operator.update",
        reason=command.reason,
        context=audit_context(request),
        role=command.role,
        status=command.status,
    )
    db.commit()
    return operator_read(row)


@router.post(
    "/operators/{operator_id}/mfa/reset",
    status_code=204,
    response_class=Response,
    operation_id="operatorMfaReset",
)
def reset_mfa(
    operator_id: str,
    command: ReasonCommand,
    request: Request,
    actor: OperatorPrincipal = Depends(require_permission(OperatorPermission.OPERATORS_MANAGE)),
    db: Session = Depends(get_db, scope="function"),
):
    manage_operator(
        db,
        actor_id=actor.operator.id,
        operator_uuid=operator_id,
        action="operator.mfa_reset",
        reason=command.reason,
        context=audit_context(request),
    )
    db.commit()
    return Response(status_code=204)


@router.post(
    "/operators/{operator_id}/password/reset",
    status_code=204,
    response_class=Response,
    operation_id="operatorPasswordReset",
)
def reset_password(
    operator_id: str,
    command: ResetOperatorPasswordCommand,
    request: Request,
    actor: OperatorPrincipal = Depends(require_permission(OperatorPermission.OPERATORS_MANAGE)),
    db: Session = Depends(get_db, scope="function"),
):
    manage_operator(
        db,
        actor_id=actor.operator.id,
        operator_uuid=operator_id,
        action="operator.password_reset",
        reason=command.reason,
        context=audit_context(request),
        password=command.password,
    )
    db.commit()
    return Response(status_code=204)


@router.get(
    "/users", response_model=OffsetPage[CustomerDirectoryRead], operation_id="customersList"
)
def list_customers(
    _actor: OperatorPrincipal = Depends(require_permission(OperatorPermission.USERS_READ)),
    db: Session = Depends(get_db, scope="function"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0, le=10000),
):
    rows = (
        db.execute(
            text("SELECT * FROM nv_customer_directory(:n,:o)"), {"n": limit + 1, "o": offset}
        )
        .mappings()
        .all()
    )
    return OffsetPage(
        items=[CustomerDirectoryRead(**row) for row in rows[:limit]],
        limit=limit,
        offset=offset,
        has_more=len(rows) > limit,
    )


@router.put(
    "/users/{user_id}/status",
    status_code=204,
    response_class=Response,
    operation_id="customerStatusUpdate",
)
def set_customer_status(
    user_id: int,
    command: CustomerStatusCommand,
    request: Request,
    actor: OperatorPrincipal = Depends(require_permission(OperatorPermission.USERS_SUSPEND)),
    db: Session = Depends(get_db, scope="function"),
):
    lock_administrator(db, actor.operator.id)
    changed = db.scalar(
        text("SELECT nv_set_customer_active(:actor,:identity,:active)"),
        {"actor": actor.operator.id, "identity": user_id, "active": command.is_active},
    )
    if not changed:
        raise ResourceNotFoundException("user", code=ControlPlaneErrorCode.RESOURCE_NOT_FOUND)
    audit_management(
        db,
        actor.operator.id,
        "user.status",
        "user",
        str(user_id),
        command.reason,
        audit_context(request),
        new_state="active" if command.is_active else "suspended",
    )
    db.commit()
    return Response(status_code=204)
