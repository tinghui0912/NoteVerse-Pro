from __future__ import annotations

import os
import tempfile
from types import SimpleNamespace
from unittest.mock import patch

from app.pipeline.steps.input import CopyImageStep
from app.pipeline.steps.preview import PreviewGenerationStep


def test_copy_image_step_copies_input_and_updates_context() -> None:
    step = CopyImageStep()

    with tempfile.TemporaryDirectory() as temp_dir:
        source_path = os.path.join(temp_dir, "source.png")
        raw_dir = os.path.join(temp_dir, "raw")

        with open(source_path, "wb") as file_handle:
            file_handle.write(b"image-bytes")

        ctx = SimpleNamespace(
            task_id="task-1",
            image_paths=[source_path],
            raw_dir=raw_dir,
            raw_paths=[],
            create_dirs=lambda include_pdf=False: os.makedirs(raw_dir, exist_ok=True),
        )

        with patch("app.pipeline.files_recorder.replace_files") as replace_files_mock:
            step.run(ctx)

        assert len(ctx.raw_paths) == 1
        assert os.path.exists(ctx.raw_paths[0])
        with open(ctx.raw_paths[0], "rb") as file_handle:
            assert file_handle.read() == b"image-bytes"
        replace_files_mock.assert_called_once()


def test_preview_generation_step_renders_and_records_preview_images() -> None:
    step = PreviewGenerationStep()

    with tempfile.TemporaryDirectory() as temp_dir:
        main_xml = os.path.join(temp_dir, "main.xml")
        preview_dir = os.path.join(temp_dir, "preview")
        musescore_exe = os.path.join(temp_dir, "MuseScore4.exe")
        os.makedirs(preview_dir, exist_ok=True)

        with open(main_xml, "w", encoding="utf-8") as file_handle:
            file_handle.write("<score-partwise />")
        with open(musescore_exe, "w", encoding="utf-8") as file_handle:
            file_handle.write("binary")

        preview_output = os.path.join(preview_dir, "preview.png")

        class FakeEngine:
            def __init__(
                self,
                musescore_path: str,
                output_folder: str,
                timeout_seconds: int | None = None,
            ) -> None:
                self.musescore_path = musescore_path
                self.output_folder = output_folder
                self.timeout_seconds = timeout_seconds

            def render_to_image(self, xml_path: str, output_name: str, format: str, dpi: int):
                with open(preview_output, "wb") as file_handle:
                    file_handle.write(b"png")
                return {"success": True, "output_path": preview_output}

        ctx = SimpleNamespace(
            task_id="task-2",
            main_xml=main_xml,
            preview_dir=preview_dir,
            remaining=lambda: 120,
        )

        with patch("app.processing.engines.musescore.MuseScoreEngine", FakeEngine):
            with patch("app.pipeline.files_recorder.replace_files") as replace_files_mock:
                with patch("app.core.config.settings.MUSESCORE_PATH", musescore_exe):
                    step.run(ctx)

        replace_files_mock.assert_called_once()
        args, kwargs = replace_files_mock.call_args
        assert args[0] == "task-2"
        assert args[2]
        assert os.path.exists(args[2][0])
        assert kwargs["dpi"] == 300
