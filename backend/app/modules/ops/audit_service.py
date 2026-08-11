"""Platform-operation audit persistence and querying."""

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.db.models import OpsAuditEvent
from app.modules.ops.schemas import AsyncOperationKind, OpsAuditEventRead, OpsAuditOutcome
from app.shared.pagination import OffsetPage


class OpsAuditService:
    async def list_events(
        self,
        db: AsyncSession,
        *,
        limit: int,
        offset: int = 0,
        actor_operator_id: int | None = None,
        action: str | None = None,
        operation_kind: AsyncOperationKind | None = None,
        operation_id: str | None = None,
        outcome: OpsAuditOutcome | None = None,
        created_after: datetime | None = None,
        created_before: datetime | None = None,
    ) -> OffsetPage[OpsAuditEventRead]:
        statement = select(OpsAuditEvent)
        if actor_operator_id is not None:
            statement = statement.where(OpsAuditEvent.actor_operator_id == actor_operator_id)
        if action is not None:
            statement = statement.where(OpsAuditEvent.action == action)
        if operation_kind is not None:
            statement = statement.where(OpsAuditEvent.operation_kind == operation_kind.value)
        if operation_id is not None:
            statement = statement.where(OpsAuditEvent.operation_id == operation_id)
        if outcome is not None:
            statement = statement.where(OpsAuditEvent.outcome == outcome.value)
        if created_after is not None:
            statement = statement.where(OpsAuditEvent.created_at >= created_after)
        if created_before is not None:
            statement = statement.where(OpsAuditEvent.created_at <= created_before)
        result = await db.execute(
            statement.order_by(col(OpsAuditEvent.created_at).desc()).offset(offset).limit(limit + 1)
        )
        events = [self._read(event) for event in result.scalars().all()]
        return OffsetPage(
            items=events[:limit], limit=limit, offset=offset, has_more=len(events) > limit
        )

    async def record_event(self, db: AsyncSession, **values) -> None:
        values["operation_kind"] = values["operation_kind"].value
        db.add(OpsAuditEvent(**values))
        await db.commit()

    @staticmethod
    def _read(event: OpsAuditEvent) -> OpsAuditEventRead:
        return OpsAuditEventRead(
            event_id=event.event_uuid,
            actor_operator_id=event.actor_operator_id,
            action=event.action,
            operation_kind=AsyncOperationKind(event.operation_kind),
            operation_id=event.operation_id,
            outcome=OpsAuditOutcome(event.outcome),
            error_code=event.error_code,
            reason=event.reason,
            request_id=event.request_id,
            peer_address=event.peer_address,
            client_address=event.client_address,
            previous_state=event.previous_state,
            new_state=event.new_state,
            created_at=event.created_at,
        )


ops_audit_service = OpsAuditService()
