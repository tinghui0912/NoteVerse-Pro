"""Core pipeline abstractions: steps and executor."""

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING, List

from celery.utils.log import get_task_logger

from app.core.exceptions import TimeoutException

if TYPE_CHECKING:
    from .context import JobContext

logger = get_task_logger(__name__)


class Step(ABC):
    """Base class for all pipeline steps."""

    name: str = "unknown"
    progress_start: int = 0
    progress_end: int = 0

    @abstractmethod
    def run(self, ctx: "JobContext") -> None:
        """Execute the step."""
        pass

    def rollback(self, ctx: "JobContext") -> None:
        """Optionally roll back side effects after a failure."""
        pass

    def __repr__(self) -> str:
        return f"<{self.__class__.__name__} name={self.name}>"


class Pipeline:
    """Sequential pipeline executor with progress and rollback handling."""

    def __init__(self, steps: List[Step]):
        """Initialize a pipeline from an ordered step list."""
        self.steps = steps

    def build_order_map(self) -> dict[str, int]:
        """Build the runtime step-order map used by step tracking."""
        order_map = {"initialization": 0}

        for idx, step in enumerate(self.steps, start=1):
            order_map[step.name] = idx

        order_map["ocr_completed"] = len(self.steps) + 1
        return order_map

    def run(self, ctx: "JobContext") -> None:
        """Run all steps in order and roll back executed steps on failure."""
        ctx.set_order_map(self)

        executed_steps: List[Step] = []

        for step in self.steps:
            try:
                self._ensure_before_deadline(ctx, step.name)
                ctx.status("PROGRESS", step.name, step.progress_start, current_step=step.name)
                logger.info(f"[{ctx.job_id}] Step started: {step.name}")

                step.run(ctx)
                executed_steps.append(step)
                self._ensure_before_deadline(ctx, step.name)

                ctx.status("PROGRESS", step.name, step.progress_end, current_step=step.name)
                logger.info(f"[{ctx.job_id}] Step completed: {step.name}")
            except Exception as exc:
                logger.error(f"[{ctx.job_id}] Step failed: {step.name} | Error: {exc}")
                self._rollback(ctx, executed_steps)
                raise

    @staticmethod
    def _ensure_before_deadline(ctx: "JobContext", step_name: str) -> None:
        """Fail consistently when a step starts or finishes after the deadline."""
        if ctx.remaining() <= 0:
            raise TimeoutException(details={"step": step_name})

    def _rollback(self, ctx: "JobContext", executed_steps: List[Step]) -> None:
        """Roll back executed steps in reverse order."""
        for step in reversed(executed_steps):
            try:
                step.rollback(ctx)
            except Exception as exc:
                logger.warning(
                    f"[{ctx.job_id}] Step rollback failed: {step.name} | Error: {exc}"
                )

    def __repr__(self) -> str:
        step_names = [step.name for step in self.steps]
        return f"<Pipeline steps={step_names}>"
