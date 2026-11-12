from collections.abc import Iterable
from typing import Annotated

from pydantic import AfterValidator

GENRE_CODES = (
    "classical",
    "pop",
    "jazz",
    "rock",
    "folk",
    "blues",
    "soundtrack",
    "anime_game",
    "religious",
    "latin",
    "children",
    "original",
    "other",
)


def ordered_unique_genres(values: Iterable[str]) -> list[str]:
    selected: set[str] = set()
    for code in values:
        if not isinstance(code, str) or code not in GENRE_CODES:
            raise ValueError(f"Unsupported genre: {code!r}")
        selected.add(code)
    return [code for code in GENRE_CODES if code in selected]


Genres = Annotated[list[str], AfterValidator(ordered_unique_genres)]
