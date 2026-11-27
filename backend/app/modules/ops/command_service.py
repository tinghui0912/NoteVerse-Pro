from dataclasses import dataclass
from collections.abc import Callable
from app.modules.ops.query_service import OpsAsyncOperationQueryService

from sqlalchemy.orm import Session

from app.core.control_plane_errors import ControlPlaneErrorCode
from app.core.exceptions import ResourceNotFoundException, ValidationException
from app.modules.ops.schemas import AsyncOperationKind, AsyncOperationRead

RETRYABLE_OPERATION_KINDS = tuple(AsyncOperationKind)


@dataclass(frozen=True)
class RetryOperationResult:
    operation: AsyncOperationRead
    previous_state: str


class OpsAsyncOperationCommandService:
    def __init__(
        self,
        owners: dict[AsyncOperationKind, Callable[[Session, str], str]],
        query: OpsAsyncOperationQueryService,
    ) -> None:
        self.owners, self.query = owners, query

    def retry_operation(
        self, db: Session, *, kind: AsyncOperationKind, operation_id: str
    ) -> RetryOperationResult:

        try:
            previous = self.owners[kind](db, operation_id)
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
            operation=self.query.get_operation(db, kind=kind, operation_id=operation_id),
            previous_state=previous,
        )
