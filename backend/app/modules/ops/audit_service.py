"""Platform-operation audit persistence and querying."""

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlmodel import col

from app.db.models import OpsAuditEvent
from app.modules.ops.schemas import OpsAuditEventRead, OpsAuditOutcome
from app.shared.pagination import OffsetPage


class OpsAuditService:
    def list_events(
        self,
        db: Session,
        *,
        limit: int,
        offset: int = 0,
        actor_operator_id: int | None = None,
        action: str | None = None,
        target_type: str | None = None,
        target_id: str | None = None,
        outcome: OpsAuditOutcome | None = None,
        created_after: datetime | None = None,
        created_before: datetime | None = None,
    ) -> OffsetPage[OpsAuditEventRead]:
        statement = select(OpsAuditEvent)
        if actor_operator_id is not None:
            statement = statement.where(OpsAuditEvent.actor_operator_id == actor_operator_id)
        if action is not None:
            statement = statement.where(OpsAuditEvent.action == action)
        if target_type is not None:
            statement = statement.where(OpsAuditEvent.target_type == target_type)
        if target_id is not None:
            statement = statement.where(OpsAuditEvent.target_id == target_id)
        if outcome is not None:
            statement = statement.where(OpsAuditEvent.outcome == outcome.value)
        if created_after is not None:
            statement = statement.where(OpsAuditEvent.created_at >= created_after)
        if created_before is not None:
            statement = statement.where(OpsAuditEvent.created_at <= created_before)
        result = db.execute(
            statement.order_by(col(OpsAuditEvent.created_at).desc()).offset(offset).limit(limit + 1)
        )
        events = [self._read(event) for event in result.scalars().all()]
        return OffsetPage(
            items=events[:limit], limit=limit, offset=offset, has_more=len(events) > limit
        )

    def record_event(self, db: Session, **values) -> None:
        db.add(OpsAuditEvent(**values))
        db.flush()

    @staticmethod
    def _read(event: OpsAuditEvent) -> OpsAuditEventRead:
        return OpsAuditEventRead(
            event_id=event.event_uuid,
            actor_operator_id=event.actor_operator_id,
            action=event.action,
            target_type=event.target_type,
            target_id=event.target_id,
            outcome=OpsAuditOutcome(event.outcome),
            error_code=event.error_code,
            reason=event.reason,
            request_id=event.request_id,
            user_agent=event.user_agent,
            ip_address=event.ip_address,
            previous_state=event.previous_state,
            new_state=event.new_state,
            metadata_json=event.metadata_json,
            created_at=event.created_at,
        )


ops_audit_service = OpsAuditService()
