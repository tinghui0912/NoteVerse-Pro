"""Central score authorization and capability resolution."""

from .policy import ScoreAction, ScoreAccessPolicy

__all__ = ["ScoreAccessPolicy", "ScoreAction"]
