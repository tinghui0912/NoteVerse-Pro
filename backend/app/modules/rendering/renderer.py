"""Render MusicXML bytes into normalized pages inside an isolated workspace."""

from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory

from app.processing.engines.render import create_score_render_engine


@dataclass(frozen=True)
class RenderedPage:
    page_number: int
    content: bytes
    mime_type: str
    extension: str
    generator: str


class RenderExecutionError(RuntimeError):
    def __init__(self, engine_code: str | None = None) -> None:
        super().__init__("MusicXML rendering failed")
        self.engine_code = engine_code


def render_musicxml(content: bytes, *, output_name: str, work_root: str) -> list[RenderedPage]:
    try:
        Path(work_root).mkdir(parents=True, exist_ok=True)
        with TemporaryDirectory(dir=work_root) as work_dir:
            xml_path = Path(work_dir) / "score.musicxml"
            xml_path.write_bytes(content)
            engine = create_score_render_engine(output_folder=work_dir)
            result = engine.render_score(xml_path=str(xml_path), output_name=output_name)
            if not result["success"] or not result.get("files"):
                code = result.get("code")
                raise RenderExecutionError(str(code) if code else None)
            return [
                RenderedPage(
                    page_number=int(output["page"]),
                    content=Path(output["path"]).read_bytes(),
                    mime_type=output["mime_type"],
                    extension=Path(output["path"]).suffix or ".svg",
                    generator=str(result.get("engine") or "score-renderer"),
                )
                for output in result["files"]
            ]
    except RenderExecutionError:
        raise
    except Exception as error:
        raise RenderExecutionError() from error
