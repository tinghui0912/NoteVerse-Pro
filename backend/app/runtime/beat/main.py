"""Beat Celery application composition."""

from pathlib import Path
from celery import Celery, signals
from app.runtime.beat.context import get_context
from app.core.logger import configure_logging
from app.core.logging_setup import configure_celery_logging
from app.task_queue.options import build_celery_runtime_options

context = get_context()
settings = context.settings
configure_logging(settings.LOG_FORMAT)
state_directory = Path(settings.WORK_ROOT) / "celerybeat"
state_directory.mkdir(parents=True, exist_ok=True)
celery_app = Celery(
    "noteverse-beat",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    include=[],
)
celery_app.conf.update(
    build_celery_runtime_options(
        settings, settings, beat_schedule_filename=state_directory / "celerybeat-schedule"
    )
)


@signals.setup_logging.connect
def setup_logging(**_: object) -> None:
    configure_celery_logging()
