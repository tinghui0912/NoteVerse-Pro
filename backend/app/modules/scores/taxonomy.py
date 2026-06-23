from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

GENRE_CATEGORY = "genre"
MAX_SCORE_TAXONOMY_TAGS = 8


@dataclass(frozen=True)
class TaxonomyTagSpec:
    category: str
    code: str
    name_key: str
    sort_order: int


GENRE_TAGS: tuple[TaxonomyTagSpec, ...] = (
    TaxonomyTagSpec(GENRE_CATEGORY, "classical", "scoreStyles.genre.classical", 10),
    TaxonomyTagSpec(GENRE_CATEGORY, "pop", "scoreStyles.genre.pop", 20),
    TaxonomyTagSpec(GENRE_CATEGORY, "jazz", "scoreStyles.genre.jazz", 30),
    TaxonomyTagSpec(GENRE_CATEGORY, "rock", "scoreStyles.genre.rock", 40),
    TaxonomyTagSpec(GENRE_CATEGORY, "folk", "scoreStyles.genre.folk", 50),
    TaxonomyTagSpec(GENRE_CATEGORY, "blues", "scoreStyles.genre.blues", 60),
    TaxonomyTagSpec(GENRE_CATEGORY, "soundtrack", "scoreStyles.genre.soundtrack", 70),
    TaxonomyTagSpec(GENRE_CATEGORY, "anime_game", "scoreStyles.genre.animeGame", 80),
    TaxonomyTagSpec(GENRE_CATEGORY, "religious", "scoreStyles.genre.religious", 90),
    TaxonomyTagSpec(GENRE_CATEGORY, "latin", "scoreStyles.genre.latin", 100),
    TaxonomyTagSpec(GENRE_CATEGORY, "children", "scoreStyles.genre.children", 110),
    TaxonomyTagSpec(GENRE_CATEGORY, "original", "scoreStyles.genre.original", 120),
    TaxonomyTagSpec(GENRE_CATEGORY, "other", "scoreStyles.genre.other", 130),
)

GENRE_CODES = frozenset(tag.code for tag in GENRE_TAGS)
VALID_TAXONOMY_CODES = {GENRE_CATEGORY: GENRE_CODES}
TAXONOMY_SORT_ORDER = {
    (tag.category, tag.code): tag.sort_order for tag in GENRE_TAGS
}


def normalize_taxonomy_value(value: str) -> str:
    return value.strip().lower().replace("-", "_")


def validate_taxonomy_pair(category: str, code: str) -> tuple[str, str]:
    normalized_category = normalize_taxonomy_value(category)
    normalized_code = normalize_taxonomy_value(code)
    valid_codes = VALID_TAXONOMY_CODES.get(normalized_category)
    if valid_codes is None or normalized_code not in valid_codes:
        raise ValueError(f"Unsupported taxonomy tag: {normalized_category}:{normalized_code}")
    return normalized_category, normalized_code


def ordered_unique_pairs(pairs: Iterable[tuple[str, str]]) -> list[tuple[str, str]]:
    seen: set[tuple[str, str]] = set()
    result: list[tuple[str, str]] = []
    for category, code in pairs:
        pair = validate_taxonomy_pair(category, code)
        if pair in seen:
            continue
        seen.add(pair)
        result.append(pair)
    if len(result) > MAX_SCORE_TAXONOMY_TAGS:
        raise ValueError(f"At most {MAX_SCORE_TAXONOMY_TAGS} taxonomy tags are allowed")
    return sorted(result, key=lambda item: TAXONOMY_SORT_ORDER[item])
