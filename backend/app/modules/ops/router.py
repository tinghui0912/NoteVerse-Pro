from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Body, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.core.exceptions import AppException
from app.db.models import User
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
from app.modules.ops.service import OpsAsyncOperationService, ops_async_operation_service
from app.shared.pagination import OffsetPage
from app.shared.responses import APIResponse, success_response

router = APIRouter()


def get_ops_async_operation_service() -> OpsAsyncOperationService:
    return ops_async_operation_service


@router.get("/audit-events", response_model=APIResponse[OffsetPage[OpsAuditEventRead]])
async def list_ops_audit_events(
    _admin_user: User = Depends(require_platform_operation(PlatformOperationAction.READ)),
    db: AsyncSession = Depends(get_db),
    service: OpsAsyncOperationService = Depends(get_ops_async_operation_service),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0, le=10000),
    actor_user_id: int | None = Query(default=None, ge=1),
    action: str | None = Query(default=None, min_length=1, max_length=64),
    operation_kind: AsyncOperationKind | None = Query(default=None),
    operation_id: str | None = Query(default=None, min_length=1, max_length=128),
    outcome: OpsAuditOutcome | None = Query(default=None),
    created_after: datetime | None = Query(default=None),
    created_before: datetime | None = Query(default=None),
):
    result = await service.list_audit_events(
        db,
        limit=limit,
        offset=offset,
        actor_user_id=actor_user_id,
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
    _admin_user: User = Depends(require_platform_operation(PlatformOperationAction.READ)),
    db: AsyncSession = Depends(get_db),
    service: OpsAsyncOperationService = Depends(get_ops_async_operation_service),
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
    _admin_user: User = Depends(require_platform_operation(PlatformOperationAction.READ)),
    db: AsyncSession = Depends(get_db),
    service: OpsAsyncOperationService = Depends(get_ops_async_operation_service),
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
    command: RetryAsyncOperationCommand | None = Body(default=None),
    admin_user: User = Depends(require_platform_operation(PlatformOperationAction.RETRY)),
    db: AsyncSession = Depends(get_db),
    service: OpsAsyncOperationService = Depends(get_ops_async_operation_service),
):
    try:
        result = await service.retry_operation(db, kind=kind, operation_id=operation_id)
    except AppException as exc:
        await service.record_audit_event(
            db,
            actor_user_id=admin_user.id,
            action="retry_async_operation",
            operation_kind=kind,
            operation_id=operation_id,
            outcome="failed",
            error_code=exc.code,
            reason=command.reason if command is not None else None,
            request_id=getattr(request.state, "request_id", None),
            peer_address=request.client.host if request.client is not None else None,
        )
        raise
    await service.record_audit_event(
        db,
        actor_user_id=admin_user.id,
        action="retry_async_operation",
        operation_kind=kind,
        operation_id=operation_id,
        outcome="succeeded",
        reason=command.reason if command is not None else None,
        request_id=getattr(request.state, "request_id", None),
        peer_address=request.client.host if request.client is not None else None,
        previous_state=result.previous_state,
        new_state=result.operation.raw_status,
    )
    return success_response(data=result.operation)
