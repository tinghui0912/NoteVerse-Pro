"""Central score authorization and capability resolution."""

from .actions import ScoreAction
from .policy import ScoreAccessPolicy

__all__ = ["ScoreAccessPolicy", "ScoreAction"]
