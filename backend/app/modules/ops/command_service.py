from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.core.control_plane_errors import ControlPlaneErrorCode
from app.core.exceptions import ResourceNotFoundException, ValidationException
from app.modules.import_jobs.dispatch_service import import_dispatch_service
from app.modules.revisions.render_delivery import revision_render_delivery
from app.modules.playback.outbox_service import playback_outbox_service
from app.modules.mail.outbox_service import mail_outbox_service
from app.modules.scores.deletion_delivery import score_deletion_delivery
from app.modules.account.deletion_delivery import account_deletion_delivery
from app.modules.storage_objects.retirement import retirement_delivery
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
            AsyncOperationKind.REVISION_RENDER: revision_render_delivery.rearm_for_operator,
            AsyncOperationKind.PLAYBACK: playback_outbox_service.rearm_for_operator,
            AsyncOperationKind.MAIL: mail_outbox_service.rearm_for_operator,
            AsyncOperationKind.SCORE_DELETION: score_deletion_delivery.rearm_for_operator,
            AsyncOperationKind.ACCOUNT_DELETION: account_deletion_delivery.rearm_for_operator,
            AsyncOperationKind.STORED_OBJECT_RETIREMENT: retirement_delivery.rearm_for_operator,
        }
        try:
            previous = owners[kind](db, operation_id)
        except ResourceNotFoundException as exc:
            raise ResourceNotFoundException(
                "async_operation", operation_id, code=ControlPlaneErrorCode.RESOURCE_NOT_FOUND
            ) from exc
        except ValidationException as exc:
            raise ValidationException(
                code=ControlPlaneErrorCode.VALIDATION_ERROR, details=exc.details
            ) from exc
        db.flush()
        return RetryOperationResult(
            operation=ops_async_operation_query_service.get_operation(
                db, kind=kind, operation_id=operation_id
            ),
            previous_state=previous,
        )


ops_async_operation_command_service = OpsAsyncOperationCommandService()
