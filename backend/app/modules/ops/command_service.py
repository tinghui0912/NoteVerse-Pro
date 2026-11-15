from dataclasses import dataclass
from sqlalchemy.orm import Session
from app.modules.import_jobs.dispatch_service import import_dispatch_service
from app.modules.score_assets.render_outbox_service import render_outbox_service
from app.modules.playback.outbox_service import playback_outbox_service
from app.modules.mail.outbox_service import mail_outbox_service
from app.modules.scores.deletion_delivery import score_deletion_delivery
from app.modules.ops.query_service import ops_async_operation_query_service
from app.modules.ops.schemas import AsyncOperationKind, AsyncOperationRead

RETRYABLE_OPERATION_KINDS = tuple(AsyncOperationKind)


@dataclass(frozen=True)
class RetryOperationResult:
    operation: AsyncOperationRead
    previous_state: str


class OpsAsyncOperationCommandService:
    def retry_operation(
        self, db: Session, *, kind: AsyncOperationKind, operation_id: str
    ) -> RetryOperationResult:
        owners = {
            AsyncOperationKind.IMPORT: import_dispatch_service.rearm_for_operator,
            AsyncOperationKind.RENDER: render_outbox_service.rearm_for_operator,
            AsyncOperationKind.PLAYBACK: playback_outbox_service.rearm_for_operator,
            AsyncOperationKind.MAIL: mail_outbox_service.rearm_for_operator,
            AsyncOperationKind.SCORE_DELETION: score_deletion_delivery.rearm_for_operator,
        }
        previous = owners[kind](db, operation_id)
        db.commit()
        return RetryOperationResult(
            operation=ops_async_operation_query_service.get_operation(
                db, kind=kind, operation_id=operation_id
            ),
            previous_state=previous,
        )


ops_async_operation_command_service = OpsAsyncOperationCommandService()
