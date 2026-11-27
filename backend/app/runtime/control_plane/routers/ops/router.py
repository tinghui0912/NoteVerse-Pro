from __future__ import annotations


from app.shared.time import Instant

from fastapi import APIRouter, Body, Depends, Query, Request
from sqlalchemy.orm import Session

from app.platform.db.dependencies import get_db
from app.shared.durable_failure import DurableFailureClass
from app.platform.security.client_ip import client_ip
from app.core.exceptions import AppException
from app.core.control_plane_errors import ControlPlaneErrorCode
from app.runtime.control_plane.deps import OperatorPrincipal
from app.modules.ops.schemas import (
    AsyncOperationKind,
    AsyncOperationRead,
    AsyncOperationsSummaryRead,
    AsyncOperationStatus,
    OpsAuditEventRead,
    OpsAuditOutcome,
    RetryAsyncOperationCommand,
)
from app.runtime.control_plane.deps import require_permission, lock_operator_command
from app.modules.platform_operators.permissions import OperatorPermission

from app.modules.ops.audit_service import OpsAuditService, ops_audit_service
from app.modules.ops.query_service import (
    OpsAsyncOperationQueryService,
)
from app.modules.ops.command_service import (
    OpsAsyncOperationCommandService,
)
from app.shared.pagination import OffsetPage

router = APIRouter()
audit_router = APIRouter()


def get_ops_async_operation_query_service(request: Request) -> OpsAsyncOperationQueryService:
    return request.app.state.ops_query


def get_ops_async_operation_command_service(request: Request) -> OpsAsyncOperationCommandService:
    return request.app.state.ops_commands


def get_ops_audit_service() -> OpsAuditService:
    return ops_audit_service


@audit_router.get(
    "/audit-logs", response_model=OffsetPage[OpsAuditEventRead], operation_id="auditLogsList"
)
def list_ops_audit_events(
    _operator: OperatorPrincipal = Depends(require_permission(OperatorPermission.AUDIT_READ)),
    db: Session = Depends(get_db, scope="function"),
    service: OpsAuditService = Depends(get_ops_audit_service),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0, le=10000),
    actor_operator_id: int | None = Query(default=None, ge=1),
    action: str | None = Query(default=None, min_length=1, max_length=64),
    target_type: str | None = Query(default=None),
    target_id: str | None = Query(default=None, min_length=1, max_length=128),
    outcome: OpsAuditOutcome | None = Query(default=None),
    created_after: Instant | None = Query(default=None),
    created_before: Instant | None = Query(default=None),
):
    result = service.list_events(
        db,
        limit=limit,
        offset=offset,
        actor_operator_id=actor_operator_id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        outcome=outcome,
        created_after=created_after,
        created_before=created_before,
    )
    return result


@router.get(
    "/async-operations",
    response_model=OffsetPage[AsyncOperationRead],
    operation_id="opsAsyncOperationsList",
)
def list_async_operations(
    _operator: OperatorPrincipal = Depends(require_permission(OperatorPermission.OPERATIONS_READ)),
    db: Session = Depends(get_db, scope="function"),
    service: OpsAsyncOperationQueryService = Depends(get_ops_async_operation_query_service),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0, le=10000),
    kind: AsyncOperationKind | None = Query(default=None),
    status: AsyncOperationStatus | None = Query(default=None),
    failure_class: DurableFailureClass | None = Query(default=None),
    resource_type: str | None = Query(default=None, min_length=1, max_length=64),
    created_after: Instant | None = Query(default=None),
    updated_before: Instant | None = Query(default=None),
):
    result = service.list_operations(
        db,
        limit=limit,
        offset=offset,
        kind=kind,
        status=status,
        failure_class=failure_class,
        resource_type=resource_type,
        created_after=created_after,
        updated_before=updated_before,
    )
    return result


@router.get(
    "/async-operations/summary",
    response_model=AsyncOperationsSummaryRead,
    operation_id="opsAsyncOperationsSummaryGet",
)
def async_operations_summary(
    _operator: OperatorPrincipal = Depends(require_permission(OperatorPermission.OPERATIONS_READ)),
    db: Session = Depends(get_db, scope="function"),
    service: OpsAsyncOperationQueryService = Depends(get_ops_async_operation_query_service),
    kind: AsyncOperationKind | None = Query(default=None),
    status: AsyncOperationStatus | None = Query(default=None),
    failure_class: DurableFailureClass | None = Query(default=None),
    resource_type: str | None = Query(default=None, min_length=1, max_length=64),
    created_after: Instant | None = Query(default=None),
    updated_before: Instant | None = Query(default=None),
):
    result = service.summary(
        db,
        kind=kind,
        status=status,
        failure_class=failure_class,
        resource_type=resource_type,
        created_after=created_after,
        updated_before=updated_before,
    )
    return result


@router.get(
    "/async-operations/{kind}/{operation_id}",
    response_model=AsyncOperationRead,
    operation_id="opsAsyncOperationGet",
)
def get_async_operation(
    kind: AsyncOperationKind,
    operation_id: str,
    _operator: OperatorPrincipal = Depends(require_permission(OperatorPermission.OPERATIONS_READ)),
    db: Session = Depends(get_db, scope="function"),
    service: OpsAsyncOperationQueryService = Depends(get_ops_async_operation_query_service),
) -> AsyncOperationRead:
    return service.get_operation(db, kind=kind, operation_id=operation_id)


@router.post(
    "/async-operations/{kind}/{operation_id}/retry",
    response_model=AsyncOperationRead,
    operation_id="opsAsyncOperationRetry",
)
def retry_async_operation(
    kind: AsyncOperationKind,
    operation_id: str,
    request: Request,
    command: RetryAsyncOperationCommand = Body(...),
    operator: OperatorPrincipal = Depends(require_permission(OperatorPermission.OPERATIONS_RETRY)),
    db: Session = Depends(get_db, scope="function"),
    service: OpsAsyncOperationCommandService = Depends(get_ops_async_operation_command_service),
    audit_service: OpsAuditService = Depends(get_ops_audit_service),
):
    lock_operator_command(db, operator, OperatorPermission.OPERATIONS_RETRY)
    try:
        with db.begin_nested():
            result = service.retry_operation(db, kind=kind, operation_id=operation_id)
    except AppException as exc:
        audit_service.record_event(
            db,
            actor_operator_id=operator.operator.id,
            action="retry_async_operation",
            target_type=kind.value,
            target_id=operation_id,
            outcome="failed",
            error_code=(
                exc.code.value
                if isinstance(exc.code, ControlPlaneErrorCode)
                else ControlPlaneErrorCode.INTERNAL_ERROR.value
            ),
            reason=command.reason,
            request_id=getattr(request.state, "request_id", None),
            user_agent=request.headers.get("user-agent", "")[:512] or None,
            ip_address=client_ip(
                request.scope,
                trusted_proxy_cidrs=request.app.state.settings.TRUSTED_PROXY_CIDRS,
                trusted_proxy_hops=request.app.state.settings.TRUSTED_PROXY_HOPS,
            ),
        )
        db.commit()
        raise
    audit_service.record_event(
        db,
        actor_operator_id=operator.operator.id,
        action="retry_async_operation",
        target_type=kind.value,
        target_id=operation_id,
        outcome="succeeded",
        reason=command.reason,
        request_id=getattr(request.state, "request_id", None),
        user_agent=request.headers.get("user-agent", "")[:512] or None,
        ip_address=client_ip(
            request.scope,
            trusted_proxy_cidrs=request.app.state.settings.TRUSTED_PROXY_CIDRS,
            trusted_proxy_hops=request.app.state.settings.TRUSTED_PROXY_HOPS,
        ),
        previous_state=result.previous_state,
        new_state=result.operation.status.value,
    )
    db.commit()
    return result.operation
