"""MusicXML sound applicability, independent of the affected playback fact."""

import re


class MusicXMLTimeOnlyError(ValueError):
    pass


def parse_time_only(value: str | None) -> tuple[int, ...] | None:
    if value is None:
        return None
    token = re.sub(r"[ \t\r\n]+", " ", value).strip(" ")
    if re.fullmatch(r"[1-9][0-9]*(, ?[1-9][0-9]*)*", token) is None:
        raise MusicXMLTimeOnlyError("invalid_time_only")
    passes = tuple(int(number) for number in token.split(","))
    if any(left >= right for left, right in zip(passes, passes[1:])):
        raise MusicXMLTimeOnlyError("invalid_time_only")
    return passes
