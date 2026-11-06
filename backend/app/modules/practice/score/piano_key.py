"""The explicit NoteVerse Practice physical piano domain, independent of input source."""

from numbers import Integral
from .generated.contract import PRACTICE_PIANO_KEY_MIN, PRACTICE_PIANO_KEY_MAX


class PracticeScoreInvalidError(ValueError):
    """A deterministic score revision cannot satisfy the Practice product contract."""


def practice_piano_key(value: object) -> int:
    # Accept integer scalars; reject truncation, bools and strings.
    if isinstance(value, bool) or not isinstance(value, Integral):
        raise PracticeScoreInvalidError(f"Unsupported Practice piano key: {value!r}")
    key = int(value)
    if not PRACTICE_PIANO_KEY_MIN <= key <= PRACTICE_PIANO_KEY_MAX:
        raise PracticeScoreInvalidError(f"Unsupported Practice piano key: {value!r}")
    return key
