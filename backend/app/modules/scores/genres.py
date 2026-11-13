from collections.abc import Iterable
from enum import StrEnum
from typing import Annotated

from pydantic import AfterValidator


class ScoreGenre(StrEnum):
    CLASSICAL = "classical"
    POP = "pop"
    JAZZ = "jazz"
    ROCK = "rock"
    FOLK = "folk"
    BLUES = "blues"
    SOUNDTRACK = "soundtrack"
    ANIME_GAME = "anime_game"
    RELIGIOUS = "religious"
    LATIN = "latin"
    CHILDREN = "children"
    ORIGINAL = "original"
    OTHER = "other"


def ordered_unique_genres(values: Iterable[ScoreGenre | str]) -> list[ScoreGenre]:
    selected = {ScoreGenre(value) for value in values}
    return [genre for genre in ScoreGenre if genre in selected]


Genres = Annotated[list[ScoreGenre], AfterValidator(ordered_unique_genres)]
