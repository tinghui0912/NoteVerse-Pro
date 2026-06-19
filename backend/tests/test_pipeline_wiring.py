from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.pipeline import PipelineBuilder
from app.pipeline.steps.input import CopyImageStep
from app.pipeline.steps.normalize import XmlNormalizeStep
from app.pipeline.steps.omr import OmrStep
from app.pipeline.steps.preview import PreviewGenerationStep
from app.processing.engines.omr.factory import create_omr_engine
from app.processing.engines.omr.legato import LegatoOmrEngine
from app.processing.engines.render.factory import create_score_render_engine
from app.processing.engines.render.verovio import VerovioRenderEngine


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
            create_dirs=lambda: os.makedirs(raw_dir, exist_ok=True),
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
        os.makedirs(preview_dir, exist_ok=True)

        with open(main_xml, "w", encoding="utf-8") as file_handle:
            file_handle.write("<score-partwise />")

        preview_output = os.path.join(preview_dir, "preview.png")

        class FakeEngine:
            engine_name = "test-renderer"
            default_output_format = "png"

            def render_score(
                self,
                *,
                xml_path: str,
                output_name: str,
                output_format: str | None = None,
            ):
                selected_format = output_format or self.default_output_format
                with open(preview_output, "wb") as file_handle:
                    file_handle.write(b"png")
                return {
                    "success": True,
                    "engine": self.engine_name,
                    "files": [
                        {
                            "path": preview_output,
                            "page": 1,
                            "format": selected_format,
                            "mime_type": "image/png",
                        }
                    ],
                    "stdout": "",
                    "stderr": "",
                }

        ctx = SimpleNamespace(
            task_id="task-2",
            main_xml=main_xml,
            preview_dir=preview_dir,
            remaining=lambda: 120,
        )

        with patch("app.processing.engines.render.create_score_render_engine", return_value=FakeEngine()):
            with patch("app.pipeline.files_recorder.replace_files") as replace_files_mock:
                step.run(ctx)

        replace_files_mock.assert_called_once()
        args, kwargs = replace_files_mock.call_args
        assert args[0] == "task-2"
        assert args[2]
        assert os.path.exists(args[2][0])


def test_pipeline_builder_uses_ordered_image_omr_step_for_all_uploads() -> None:
    single = PipelineBuilder.build_single_image()
    multi = PipelineBuilder.build_multi_image()

    assert any(isinstance(step, OmrStep) for step in single.steps)
    assert any(isinstance(step, OmrStep) for step in multi.steps)


def test_xml_normalize_step_applies_a4_layout() -> None:
    step = XmlNormalizeStep()

    with tempfile.TemporaryDirectory() as temp_dir:
        xml_path = os.path.join(temp_dir, "score.musicxml")
        with open(xml_path, "w", encoding="utf-8") as file_handle:
            file_handle.write(
                "<score-partwise><part-list />"
                "<part id=\"P1\"><measure number=\"0\" /></part>"
                "</score-partwise>"
            )

        ctx = SimpleNamespace(task_id="task-normalize", main_xml=xml_path)
        step.run(ctx)

        root = ET.parse(xml_path).getroot()

    assert root.findtext("./defaults/page-layout/page-width") == step.A4_PAGE_WIDTH
    assert root.findtext("./defaults/page-layout/page-height") == step.A4_PAGE_HEIGHT
    assert root.find("./defaults/system-layout") is None
    assert root.find("./part/measure").get("number") == "1"


def test_factory_can_create_legato_engine() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        engine = create_omr_engine(
            output_folder=temp_dir,
            timeout_seconds=120,
            engine_name="legato",
        )

    assert isinstance(engine, LegatoOmrEngine)


def test_score_render_factory_can_create_verovio_engine() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        verovio = create_score_render_engine(
            output_folder=temp_dir,
            engine_name="verovio",
        )

    assert isinstance(verovio, VerovioRenderEngine)


def test_engine_factories_reject_unregistered_engines() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        with pytest.raises(ValueError, match="Unsupported OMR engine"):
            create_omr_engine(
                output_folder=temp_dir,
                timeout_seconds=120,
                engine_name="unknown",
            )
        with pytest.raises(ValueError, match="Unsupported score render engine"):
            create_score_render_engine(output_folder=temp_dir, engine_name="unknown")


def test_verovio_render_engine_writes_svg_pages() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        xml_path = os.path.join(temp_dir, "score.musicxml")
        with open(xml_path, "w", encoding="utf-8") as file_handle:
            file_handle.write("<score-partwise />")

        class FakeToolkit:
            def setOptions(self, options):
                self.options = options
                captured_options.update(options)

            def loadFile(self, path):
                self.path = path
                return True

            def getPageCount(self):
                return 2

            def renderToSVG(self, page):
                return f"<svg><text>page {page}</text></svg>"

        fake_verovio = SimpleNamespace(toolkit=lambda: FakeToolkit())
        captured_options = {}

        with patch.dict(sys.modules, {"verovio": fake_verovio}):
            engine = VerovioRenderEngine(output_folder=temp_dir)
            result = engine.render_score(
                xml_path=xml_path,
                output_name="preview",
                output_format="svg",
            )

        assert result["success"] is True
        assert result["engine"] == "verovio"
        assert len(result["files"]) == 2
        assert result["files"][0]["mime_type"] == "image/svg+xml"
        assert os.path.exists(result["files"][0]["path"])
        svg_content = open(result["files"][0]["path"], encoding="utf-8").read()
        assert 'data-nv-background="true"' in svg_content
        assert 'fill="white"' in svg_content
        assert captured_options["justifyVertically"] is True
        assert captured_options["pageMarginTop"] == 390
        assert captured_options["pageMarginBottom"] == 80
        assert captured_options["header"] == "none"
        assert captured_options["footer"] == "always"
        assert captured_options["usePgFooterForAll"] is True


def test_legato_omr_engine_writes_musicxml_result() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        image_path = os.path.join(temp_dir, "input.png")
        with open(image_path, "wb") as file_handle:
            file_handle.write(b"image")

        engine = LegatoOmrEngine(
            output_folder=temp_dir,
            timeout_seconds=120,
            repo_path=temp_dir,
            python_executable="python",
            model_path="model",
            processor_path="processor",
            device="cpu",
            fp16=False,
        )

        inference_result = subprocess.CompletedProcess(
            args=["legato"],
            returncode=0,
            stdout="ok",
            stderr="",
        )
        conversion_xml = """<?xml version='1.0' encoding='utf-8'?>
<score-partwise>
  <part id="P1">
    <measure number="1">
      <attributes><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef></attributes>
      <note><rest /><duration>1</duration><voice>1</voice><staff>1</staff></note>
      <backup><duration>1</duration></backup>
      <attributes><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
      <note><rest measure="yes" /><duration>1</duration><voice>2</voice><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>
"""
        conversion_result = subprocess.CompletedProcess(
            args=["abc2xml"],
            returncode=0,
            stdout=conversion_xml.encode("utf-8"),
            stderr=b"",
        )

        def fake_inference(_image_paths, prediction_path):
            with open(prediction_path, "w", encoding="utf-8") as file_handle:
                file_handle.write('{"abc_transcription": ["X:1\\nK:C\\nC|"], "tokens": []}')
            return inference_result

        with patch.object(engine, "_check_prerequisites") as check_mock:
            with patch.object(engine, "_run_inference", side_effect=fake_inference) as inference_mock:
                with patch.object(engine, "_read_abcs", return_value=["X:1\nK:C\nC|"]) as read_mock:
                    with patch.object(engine, "_cleanup_abc", return_value="X:1\nK:C\nC|") as cleanup_mock:
                        with patch.object(engine, "_run_abc2xml", return_value=conversion_result) as convert_mock:
                            result = engine.process_images([image_path])

        assert result["success"] is True
        assert result["engine"] == "legato"
        assert os.path.exists(result["files"]["xml"])
        assert os.path.exists(result["files"]["abc"])
        assert os.path.exists(result["files"]["raw_prediction"])
        xml_content = open(result["files"]["xml"], encoding="utf-8").read()
        assert xml_content.index('<clef number="2">') < xml_content.index("<backup>")
        check_mock.assert_called_once_with([image_path])
        inference_mock.assert_called_once()
        read_mock.assert_called_once()
        cleanup_mock.assert_called_once()
        convert_mock.assert_called_once()


def test_legato_omr_engine_merges_multi_page_musicxml() -> None:
    with tempfile.TemporaryDirectory() as temp_dir:
        image_paths = []
        for index in range(2):
            image_path = os.path.join(temp_dir, f"input-{index}.png")
            with open(image_path, "wb") as file_handle:
                file_handle.write(b"image")
            image_paths.append(image_path)

        engine = LegatoOmrEngine(
            output_folder=temp_dir,
            timeout_seconds=120,
            repo_path=temp_dir,
            python_executable="python",
            model_path="model",
            processor_path="processor",
            device="cpu",
            fp16=False,
        )

        inference_result = subprocess.CompletedProcess(
            args=["legato"],
            returncode=0,
            stdout="ok",
            stderr="",
        )

        def fake_inference(_image_paths, prediction_path):
            with open(prediction_path, "w", encoding="utf-8") as file_handle:
                file_handle.write(
                    '{"abc_transcription": ["X:1\\nK:C\\nC|", "X:1\\nK:C\\nD|"], "tokens": []}'
                )
            return inference_result

        def fake_convert(_cleaned_abc, stem="prediction"):
            note_step = "C" if stem == "page-001" else "D"
            conversion_xml = f"""<?xml version='1.0' encoding='utf-8'?>
<score-partwise>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1"><note><pitch><step>{note_step}</step><octave>4</octave></pitch><duration>1</duration></note></measure>
  </part>
</score-partwise>
"""
            return subprocess.CompletedProcess(
                args=["abc2xml"],
                returncode=0,
                stdout=conversion_xml.encode("utf-8"),
                stderr=b"",
            )

        with patch.object(engine, "_check_prerequisites"):
            with patch.object(engine, "_run_inference", side_effect=fake_inference):
                with patch.object(engine, "_read_abcs", return_value=["abc1", "abc2"]):
                    with patch.object(engine, "_cleanup_abc", side_effect=lambda value: value):
                        with patch.object(engine, "_run_abc2xml", side_effect=fake_convert):
                            result = engine.process_images(image_paths)

        assert result["success"] is True
        xml_path = result["files"]["xml"]
        assert xml_path.endswith("prediction.musicxml")
        root = ET.parse(xml_path).getroot()
        measures = root.findall("./part/measure")
        assert [measure.get("number") for measure in measures] == ["1", "2"]
        assert measures[1].find("print").get("new-page") == "yes"
