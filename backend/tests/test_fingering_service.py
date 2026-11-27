from __future__ import annotations


from collections.abc import Callable
from pathlib import Path

import pytest

from app.core.exceptions import ExternalServiceException, ValidationException
from app.modules.fingering.schemas import FingeringRequest
from app.modules.fingering.service import FingeringService
from app.processing.engines.fingering.pianoplayer import (
    PianoplayerFingeringEngine,
    strip_existing_fingerings,
)
from app.runtime.customer_api.context import get_context
from app.platform.config.fingering_execution import FingeringExecutionSettings

settings = get_context().settings


MUSICXML = """<?xml version="1.0"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes><note><rest/><duration>1</duration></note></measure></part>
</score-partwise>"""


class AllowEditAccessPolicy:
    def __init__(self) -> None:
        self.calls: list[tuple[str, object, int]] = []

    def authorize_score(
        self, _db: object, score_id: str, action: object, **context: object
    ) -> object:
        self.calls.append((score_id, action, int(context["user_id"])))
        return object()


class FakeEngine:
    def __init__(self, content: str = MUSICXML) -> None:
        self.content = content
        self.calls: list[dict[str, str]] = []

    def generate(self, score_id: str, xml_content: str, hand_size: str = "M") -> dict[str, str]:
        self.calls.append(
            {"score_id": score_id, "xml_content": xml_content, "hand_size": hand_size}
        )
        return {"xml_content": self.content, "hand_size": hand_size}


class InlineExecution:
    async def run(
        self, operation: Callable[..., object], /, *args: object, **kwargs: object
    ) -> object:
        return operation(*args, **kwargs)


@pytest.mark.asyncio
async def test_generation_authorizes_and_returns_an_unsaved_xml_suggestion() -> None:
    policy = AllowEditAccessPolicy()
    engine = FakeEngine()
    service = FingeringService(
        access_policy=policy,  # type: ignore[arg-type]
        engine=engine,
        execution=InlineExecution(),  # type: ignore[arg-type]
        config=FingeringExecutionSettings(),
    )

    service.authorize_generation(object(), "score-1", 9)
    result = await service.generate(
        "score-1",
        FingeringRequest(content=MUSICXML, hand_size="L"),
    )

    assert result.content == MUSICXML
    assert len(policy.calls) == 1
    assert policy.calls[0][0] == "score-1"
    assert policy.calls[0][2] == 9
    assert engine.calls == [{"score_id": "score-1", "xml_content": MUSICXML, "hand_size": "L"}]


@pytest.mark.asyncio
async def test_generation_rejects_invalid_input_and_invalid_engine_output() -> None:
    service = FingeringService(
        access_policy=AllowEditAccessPolicy(),  # type: ignore[arg-type]
        engine=FakeEngine(content="<invalid />"),
        execution=InlineExecution(),  # type: ignore[arg-type]
        config=FingeringExecutionSettings(),
    )

    with pytest.raises(ValidationException):
        await service.generate("score-1", FingeringRequest(content="<invalid />"))  # type: ignore[arg-type]

    with pytest.raises(ExternalServiceException):
        await service.generate("score-1", FingeringRequest(content=MUSICXML))  # type: ignore[arg-type]


def test_pianoplayer_engine_uses_a_unique_cleaned_temporary_directory(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(settings, "WORK_ROOT", str(tmp_path))
    seen_directories: list[Path] = []

    def runner(input_path: str, *, outputfile: str, **_kwargs: object) -> None:
        input_file = Path(input_path)
        output_file = Path(outputfile)
        seen_directories.append(input_file.parent)
        output_file.write_text(input_file.read_text(encoding="utf-8"), encoding="utf-8")

    engine = PianoplayerFingeringEngine(work_root=str(tmp_path), runner=runner)
    first = engine.generate("../../untrusted-score", MUSICXML)
    second = engine.generate("../../untrusted-score", MUSICXML)

    assert "score-partwise" in first["xml_content"]
    assert "score-partwise" in second["xml_content"]
    assert len(seen_directories) == 2
    assert seen_directories[0] != seen_directories[1]
    assert all(not directory.exists() for directory in seen_directories)
    assert not list(tmp_path.rglob("input.musicxml"))


def test_strip_existing_fingerings_before_generation() -> None:
    xml = """<?xml version="1.0"?>
<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration>
    <notations><technical><fingering>5</fingering></technical></notations></note>
    <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration>
    <notations><technical><fingering>3</fingering></technical><slur type="start" number="1"/></notations></note>
  </measure></part></score-partwise>"""

    stripped = strip_existing_fingerings(xml)

    assert "<fingering>" not in stripped
    assert "<technical" not in stripped
    assert "slur" in stripped


@pytest.mark.asyncio
async def test_semantically_invalid_input_is_rejected_before_fingering_execution():
    from app.shared.error_codes import CustomerErrorCode

    engine = FakeEngine()
    service = FingeringService(
        access_policy=AllowEditAccessPolicy(),
        engine=engine,
        execution=InlineExecution(),
        config=FingeringExecutionSettings(),
    )
    invalid = MUSICXML.replace("<note>", "<backup><duration>1</duration></backup><note>", 1)
    with pytest.raises(ValidationException) as caught:
        await service.generate("score-1", FingeringRequest(content=invalid))
    assert caught.value.code == CustomerErrorCode.REVISION_CONTENT_INVALID
    assert engine.calls == []


@pytest.mark.asyncio
async def test_semantically_invalid_generated_output_is_fingering_failure():
    from app.shared.error_codes import CustomerErrorCode

    invalid = MUSICXML.replace("<note>", "<backup><duration>1</duration></backup><note>", 1)
    engine = FakeEngine(content=invalid)
    service = FingeringService(
        access_policy=AllowEditAccessPolicy(),
        engine=engine,
        execution=InlineExecution(),
        config=FingeringExecutionSettings(),
    )
    with pytest.raises(ExternalServiceException) as caught:
        await service.generate("score-1", FingeringRequest(content=MUSICXML))
    assert caught.value.code == CustomerErrorCode.SCORE_FINGERING_FAILED
    assert len(engine.calls) == 1
