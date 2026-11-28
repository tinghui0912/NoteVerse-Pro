"""CLI selection of independently configured runtime readiness checks."""

from app.platform.runtime import RuntimeRole
from app.runtime.checks import RuntimeChecks, WorkerCheckConfig, CheckResult


def checks_for_role(role: RuntimeRole) -> RuntimeChecks:
    if role is RuntimeRole.API:
        from app.runtime.customer_api.context import get_context

        context = get_context()
        return RuntimeChecks(
            context.engine,
            broker_url=context.settings.CELERY_BROKER_URL,
            work_root=context.settings.WORK_ROOT,
        )
    if role is RuntimeRole.CONTROL_PLANE:
        from app.runtime.control_plane.context import get_context as get_control_context

        control = get_control_context()
        return RuntimeChecks(
            control.engine,
            broker_url=control.settings.REDIS_URL,
            control=control.settings.to_security_settings(),
        )
    if role is RuntimeRole.WORKER:
        from app.runtime.worker.context import get_context as get_worker_context
        from app.runtime.worker.main import celery_app

        worker = get_worker_context()
        return RuntimeChecks(
            worker.engine,
            broker_url=worker.settings.CELERY_BROKER_URL,
            work_root=worker.settings.WORK_ROOT,
            worker=WorkerCheckConfig.model_validate(worker.settings.model_dump()),
            celery_app=celery_app,
        )
    if role is RuntimeRole.BEAT:
        from app.runtime.beat.context import get_context as get_beat_context

        beat = get_beat_context()
        return RuntimeChecks(
            beat.engine,
            broker_url=beat.settings.CELERY_BROKER_URL,
            work_root=beat.settings.WORK_ROOT,
        )
    raise ValueError("Select a concrete runtime role")


async def run_runtime_checks(
    role: RuntimeRole, *, include_sizes: bool = False
) -> list[CheckResult]:
    roles = (
        tuple(item for item in RuntimeRole if item is not RuntimeRole.ALL)
        if role is RuntimeRole.ALL
        else (role,)
    )
    results = []
    for selected in roles:
        results.extend(
            await checks_for_role(selected).run_runtime_checks(
                selected, include_sizes=include_sizes
            )
        )
    return results
