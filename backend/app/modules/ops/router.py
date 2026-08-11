from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Body, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.core.client_address import client_address, peer_address
from app.core.exceptions import AppException
from app.modules.platform_operators.dependencies import OperatorPrincipal
from app.modules.ops.schemas import (
    AsyncOperationErrorClass,
    AsyncOperationKind,
    AsyncOperationRead,
    AsyncOperationsSummaryRead,
    AsyncOperationStatus,
    OpsAuditEventRead,
    OpsAuditOutcome,
    RetryAsyncOperationCommand,
)
from app.modules.ops.authorization import PlatformOperationAction, require_platform_operation
from app.modules.ops.audit_service import OpsAuditService, ops_audit_service
from app.modules.ops.query_service import (
    OpsAsyncOperationQueryService,
    ops_async_operation_query_service,
)
from app.modules.ops.service import (
    OpsAsyncOperationCommandService,
    ops_async_operation_command_service,
)
from app.shared.pagination import OffsetPage
from app.shared.responses import APIResponse, success_response

router = APIRouter()


def get_ops_async_operation_query_service() -> OpsAsyncOperationQueryService:
    return ops_async_operation_query_service


def get_ops_async_operation_command_service() -> OpsAsyncOperationCommandService:
    return ops_async_operation_command_service


def get_ops_audit_service() -> OpsAuditService:
    return ops_audit_service


@router.get("/audit-events", response_model=APIResponse[OffsetPage[OpsAuditEventRead]])
async def list_ops_audit_events(
    _operator: OperatorPrincipal = Depends(require_platform_operation(PlatformOperationAction.READ)),
    db: AsyncSession = Depends(get_db),
    service: OpsAuditService = Depends(get_ops_audit_service),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0, le=10000),
    actor_operator_id: int | None = Query(default=None, ge=1),
    action: str | None = Query(default=None, min_length=1, max_length=64),
    operation_kind: AsyncOperationKind | None = Query(default=None),
    operation_id: str | None = Query(default=None, min_length=1, max_length=128),
    outcome: OpsAuditOutcome | None = Query(default=None),
    created_after: datetime | None = Query(default=None),
    created_before: datetime | None = Query(default=None),
):
    result = await service.list_events(
        db,
        limit=limit,
        offset=offset,
        actor_operator_id=actor_operator_id,
        action=action,
        operation_kind=operation_kind,
        operation_id=operation_id,
        outcome=outcome,
        created_after=created_after,
        created_before=created_before,
    )
    return success_response(data=result)


@router.get("/async-operations", response_model=APIResponse[OffsetPage[AsyncOperationRead]])
async def list_async_operations(
    _operator: OperatorPrincipal = Depends(require_platform_operation(PlatformOperationAction.READ)),
    db: AsyncSession = Depends(get_db),
    service: OpsAsyncOperationQueryService = Depends(get_ops_async_operation_query_service),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0, le=10000),
    kind: AsyncOperationKind | None = Query(default=None),
    status: AsyncOperationStatus | None = Query(default=None),
    error_class: AsyncOperationErrorClass | None = Query(default=None),
    resource_type: str | None = Query(default=None, min_length=1, max_length=64),
    created_after: datetime | None = Query(default=None),
    updated_before: datetime | None = Query(default=None),
):
    result = await service.list_operations(
        db,
        limit=limit,
        offset=offset,
        kind=kind,
        status=status,
        error_class=error_class,
        resource_type=resource_type,
        created_after=created_after,
        updated_before=updated_before,
    )
    return success_response(data=result)


@router.get("/async-operations/summary", response_model=APIResponse[AsyncOperationsSummaryRead])
async def async_operations_summary(
    _operator: OperatorPrincipal = Depends(require_platform_operation(PlatformOperationAction.READ)),
    db: AsyncSession = Depends(get_db),
    service: OpsAsyncOperationQueryService = Depends(get_ops_async_operation_query_service),
    kind: AsyncOperationKind | None = Query(default=None),
    status: AsyncOperationStatus | None = Query(default=None),
    error_class: AsyncOperationErrorClass | None = Query(default=None),
    resource_type: str | None = Query(default=None, min_length=1, max_length=64),
    created_after: datetime | None = Query(default=None),
    updated_before: datetime | None = Query(default=None),
):
    result = await service.summary(
        db,
        kind=kind,
        status=status,
        error_class=error_class,
        resource_type=resource_type,
        created_after=created_after,
        updated_before=updated_before,
    )
    return success_response(data=result)


@router.post(
    "/async-operations/{kind}/{operation_id}/retry",
    response_model=APIResponse[AsyncOperationRead],
)
async def retry_async_operation(
    kind: AsyncOperationKind,
    operation_id: str,
    request: Request,
    command: RetryAsyncOperationCommand = Body(...),
    operator: OperatorPrincipal = Depends(require_platform_operation(PlatformOperationAction.RETRY)),
    db: AsyncSession = Depends(get_db),
    service: OpsAsyncOperationCommandService = Depends(get_ops_async_operation_command_service),
    audit_service: OpsAuditService = Depends(get_ops_audit_service),
):
    try:
        result = await service.retry_operation(db, kind=kind, operation_id=operation_id)
    except AppException as exc:
        await audit_service.record_event(
            db,
            actor_operator_id=operator.operator.id,
            actor_identity_provider=operator.identity.provider.value,
            actor_identity_issuer=operator.identity.issuer,
            actor_identity_subject=operator.identity.subject,
            action="retry_async_operation",
            operation_kind=kind,
            operation_id=operation_id,
            outcome="failed",
            error_code=exc.code,
            reason=command.reason,
            request_id=getattr(request.state, "request_id", None),
            peer_address=peer_address(request),
            client_address=client_address(request),
        )
        raise
    await audit_service.record_event(
        db,
        actor_operator_id=operator.operator.id,
        actor_identity_provider=operator.identity.provider.value,
        actor_identity_issuer=operator.identity.issuer,
        actor_identity_subject=operator.identity.subject,
        action="retry_async_operation",
        operation_kind=kind,
        operation_id=operation_id,
        outcome="succeeded",
        reason=command.reason,
        request_id=getattr(request.state, "request_id", None),
        peer_address=peer_address(request),
        client_address=client_address(request),
        previous_state=result.previous_state,
        new_state=result.operation.raw_status,
    )
    return success_response(data=result.operation)
