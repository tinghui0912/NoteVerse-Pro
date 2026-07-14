from __future__ import annotations

import json
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_active_superuser, get_db
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
    OpsOffsetPage,
)
from app.modules.ops.service import OpsAsyncOperationService, ops_async_operation_service
from app.shared.responses import APIResponse, success_response

router = APIRouter()


def get_ops_async_operation_service() -> OpsAsyncOperationService:
    return ops_async_operation_service


@router.get("/audit-events", response_model=APIResponse[OpsOffsetPage[OpsAuditEventRead]])
async def list_ops_audit_events(
    _admin_user: User = Depends(get_current_active_superuser),
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


@router.get("/async-operations", response_model=APIResponse[OpsOffsetPage[AsyncOperationRead]])
async def list_async_operations(
    _admin_user: User = Depends(get_current_active_superuser),
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
    _admin_user: User = Depends(get_current_active_superuser),
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
    admin_user: User = Depends(get_current_active_superuser),
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
            error_detail=json.dumps(exc.details, ensure_ascii=False, sort_keys=True)
            if exc.details
            else None,
        )
        raise
    await service.record_audit_event(
        db,
        actor_user_id=admin_user.id,
        action="retry_async_operation",
        operation_kind=kind,
        operation_id=operation_id,
        outcome="succeeded",
    )
    return success_response(data=result)
