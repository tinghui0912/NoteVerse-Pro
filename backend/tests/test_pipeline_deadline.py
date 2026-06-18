from unittest.mock import Mock

import pytest

from app.core.exceptions import TimeoutException
from app.pipeline.base import Pipeline, Step
from app.pipeline.context import TaskContext


class DeadlineTestStep(Step):
    name = "deadline_test"

    def __init__(self) -> None:
        self.run_calls = 0
        self.rollback_calls = 0

    def run(self, ctx: TaskContext) -> None:
        self.run_calls += 1

    def rollback(self, ctx: TaskContext) -> None:
        self.rollback_calls += 1


def test_pipeline_rejects_step_after_deadline() -> None:
    step = DeadlineTestStep()
    context = Mock()
    context.task_id = "task-123"
    context.remaining.return_value = 0

    with pytest.raises(TimeoutException):
        Pipeline([step]).run(context)

    assert step.run_calls == 0
    assert step.rollback_calls == 0


def test_pipeline_rolls_back_step_that_finishes_after_deadline() -> None:
    step = DeadlineTestStep()
    context = Mock()
    context.task_id = "task-123"
    context.remaining.side_effect = [1, 0]

    with pytest.raises(TimeoutException):
        Pipeline([step]).run(context)

    assert step.run_calls == 1
    assert step.rollback_calls == 1
