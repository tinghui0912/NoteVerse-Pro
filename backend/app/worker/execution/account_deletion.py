"""Account deletion lease and bounded unit transactions, followed by durable continuation."""

from app.db.session import SessionLocal
from app.core.logger import logger
from app.modules.account.deletion_delivery import (
    account_deletion_delivery as delivery,
    StaleAccountDeletionAttempt,
)
from app.composition.account_deletion import AccountDeletionExecutor
from app.modules.storage_inventory.composition import build_storage_inventory_registry
from app.worker.task_runtime import bind_task_context, clear_task_context, run_scheduler_scan
from app.worker.dispatch.account_deletion import (
    dispatch_account_deletion,
    dispatch_account_deletion_best_effort,
)


def execute_account_deletion_task(task, operation_uuid: str) -> dict[str, str]:
    bind_task_context(task)
    try:
        with SessionLocal.begin() as db:
            lease = delivery.claim(db, operation_uuid)
        if lease is None:
            return {"status": "ignored"}
        try:
            with SessionLocal.begin() as db:
                completed = AccountDeletionExecutor(build_storage_inventory_registry()).execute(
                    db, lease
                )
        except StaleAccountDeletionAttempt:
            return {"status": "ignored"}
        except Exception as error:
            with SessionLocal.begin() as db:
                delivery.fail(db, lease, error)
            logger.bind(
                operation_kind="account_deletion",
                operation_id=operation_uuid,
                attempt=lease.attempt,
                exception_type=type(error).__name__,
            ).error("account_deletion.failed")
            raise
        if not completed:
            dispatch_account_deletion_best_effort(operation_uuid)
        return {"status": "completed" if completed else "continued"}
    finally:
        clear_task_context()


def execute_account_deletion_maintenance() -> dict[str, int]:
    def scan() -> dict[str, int]:
        with SessionLocal.begin() as db:
            due = delivery.recover_and_list_due(db)
        return {"due": len(due), "dispatched": sum(dispatch_account_deletion(uuid) for uuid in due)}

    return run_scheduler_scan("account_deletion", scan)
