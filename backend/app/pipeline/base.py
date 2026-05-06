"""Core pipeline abstractions: steps and executor."""

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING, List

from celery.utils.log import get_task_logger

if TYPE_CHECKING:
    from .context import TaskContext

logger = get_task_logger(__name__)


class Step(ABC):
    """Base class for all pipeline steps."""

    name: str = "unknown"
    progress_start: int = 0
    progress_end: int = 0

    @abstractmethod
    def run(self, ctx: "TaskContext") -> None:
        """Execute the step."""
        pass

    def rollback(self, ctx: "TaskContext") -> None:
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

    def run(self, ctx: "TaskContext") -> None:
        """Run all steps in order and roll back executed steps on failure."""
        ctx.set_order_map(self)

        executed_steps: List[Step] = []

        for step in self.steps:
            ctx.status("PROGRESS", step.name, step.progress_start, current_step=step.name)
            logger.info(f"[{ctx.task_id}] Step started: {step.name}")

            try:
                step.run(ctx)
                executed_steps.append(step)

                ctx.status("PROGRESS", step.name, step.progress_end, current_step=step.name)
                logger.info(f"[{ctx.task_id}] Step completed: {step.name}")
            except Exception as exc:
                logger.error(f"[{ctx.task_id}] Step failed: {step.name} | Error: {exc}")
                self._rollback(ctx, executed_steps)
                raise

    def _rollback(self, ctx: "TaskContext", executed_steps: List[Step]) -> None:
        """Roll back executed steps in reverse order."""
        for step in reversed(executed_steps):
            try:
                step.rollback(ctx)
            except Exception as exc:
                logger.warning(
                    f"[{ctx.task_id}] Step rollback failed: {step.name} | Error: {exc}"
                )

    def __repr__(self) -> str:
        step_names = [step.name for step in self.steps]
        return f"<Pipeline steps={step_names}>"
