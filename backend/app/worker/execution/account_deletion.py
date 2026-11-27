"""Account deletion lease and bounded unit transactions, followed by durable continuation."""

from app.core.logger import logger
from app.modules.account.deletion_delivery import StaleAccountDeletionAttempt
from app.composition.account_deletion import AccountDeletionExecutor
from app.composition.storage_inventory import build_storage_inventory_registry
from app.worker.task_runtime import bind_task_context, clear_task_context, run_scheduler_scan
from app.runtime.worker.context import get_context


def execute_account_deletion_task(task, operation_uuid: str) -> dict[str, str]:
    bind_task_context(task)
    try:
        with get_context().sessions.begin() as db:
            lease = get_context().deliveries.account_deletion.claim(db, operation_uuid)
        if lease is None:
            return {"status": "ignored"}
        try:
            with get_context().sessions.begin() as db:
                completed = AccountDeletionExecutor(
                    build_storage_inventory_registry(),
                    get_context().resources,
                    get_context().deliveries.account_deletion,
                    get_context().settings,
                ).execute(db, lease)
        except StaleAccountDeletionAttempt:
            return {"status": "ignored"}
        except Exception as error:
            with get_context().sessions.begin() as db:
                get_context().deliveries.account_deletion.fail(db, lease, error)
            logger.bind(
                operation_kind="account_deletion",
                operation_id=operation_uuid,
                attempt=lease.attempt,
                exception_type=type(error).__name__,
            ).error("account_deletion.failed")
            raise
        if not completed:
            get_context().dispatches.account_deletion.dispatch_account_deletion_best_effort(
                operation_uuid
            )
        return {"status": "completed" if completed else "continued"}
    finally:
        clear_task_context()


def execute_account_deletion_maintenance() -> dict[str, int]:
    def scan() -> dict[str, int]:
        with get_context().sessions.begin() as db:
            due = get_context().deliveries.account_deletion.recover_and_list_due(db)
        return {
            "due": len(due),
            "dispatched": sum(
                get_context().dispatches.account_deletion.dispatch_account_deletion(uuid)
                for uuid in due
            ),
        }

    return run_scheduler_scan("account_deletion", scan)
