"""LEGATO implementation of the generic OMR engine contract."""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import subprocess
from typing import Callable
import copy
import xml.etree.ElementTree as ET

from app.core.config import get_worker_runtime_settings
from app.core.logger import logger
from app.processing.musicxml import normalize_initial_musicxml_clefs
from app.shared.constants import ErrorCode

from .base import OmrFailureResult, OmrOutputFiles, OmrResult, OmrSuccessResult


class LegatoConversionError(RuntimeError):
    """Raised when LEGATO ABC to MusicXML conversion fails."""


class LegatoOmrEngine:
    """Run LEGATO and convert its ABC prediction to MusicXML."""

    engine_name = "legato"

    def __init__(
        self,
        output_folder: str,
        timeout_seconds: int,
        repo_path: str | None = None,
        python_executable: str | None = None,
        model_path: str | None = None,
        processor_path: str | None = None,
        device: str | None = None,
        fp16: bool | None = None,
        beam_size: int | None = None,
        batch_size: int | None = None,
    ) -> None:
        settings = get_worker_runtime_settings()
        self.output_folder = Path(output_folder)
        self.timeout_seconds = min(
            timeout_seconds,
            int(settings.LEGATO_TIMEOUT_SECONDS),
        )
        self.repo_path = Path(repo_path or settings.LEGATO_REPO_PATH or "")
        self.python_executable = python_executable or settings.LEGATO_PYTHON
        self.model_path = model_path or settings.LEGATO_MODEL_PATH
        self.processor_path = (
            processor_path
            or settings.LEGATO_PROCESSOR_PATH
            or self.model_path
        )
        self.device = device or settings.LEGATO_DEVICE
        self.fp16 = settings.LEGATO_FP16 if fp16 is None else fp16
        self.beam_size = beam_size or settings.LEGATO_BEAM_SIZE
        self.batch_size = batch_size or settings.LEGATO_BATCH_SIZE

    def process_images(self, image_paths: list[str]) -> OmrResult:
        try:
            logger.bind(
                event="legato_omr.processing_started",
                engine=self.engine_name,
                page_count=len(image_paths),
                timeout_seconds=self.timeout_seconds,
                device=self.device,
            ).info("LEGATO OMR processing started")
            self._check_prerequisites(image_paths)
            self.output_folder.mkdir(parents=True, exist_ok=True)

            prediction_path = self.output_folder / "prediction_abc.json"
            inference = self._run_inference(
                [Path(path) for path in image_paths],
                prediction_path,
            )
            if inference.returncode != 0:
                return self._failure(
                    ErrorCode.SCORE_RECOGNITION_FAILED,
                    "LEGATO inference failed",
                    inference.stderr,
                )

            logger.bind(
                event="legato_omr.inference_completed",
                engine=self.engine_name,
                page_count=len(image_paths),
            ).info("LEGATO OMR inference completed")

            abcs = self._read_abcs(prediction_path)
            if len(abcs) != len(image_paths):
                return self._failure(
                    ErrorCode.SCORE_RECOGNITION_FAILED,
                    "LEGATO prediction count does not match input page count",
                )

            page_xml_paths: list[Path] = []
            abc_path: Path | None = None
            for index, abc in enumerate(abcs, 1):
                stem = "prediction" if len(abcs) == 1 else f"page-{index:03d}"
                generated_abc_path, page_xml_path = self._convert_abc_page(abc, stem)
                if abc_path is None:
                    abc_path = generated_abc_path
                page_xml_paths.append(page_xml_path)

            musicxml_path = (
                page_xml_paths[0]
                if len(page_xml_paths) == 1
                else self._merge_musicxml_pages(
                    page_xml_paths,
                    self.output_folder / "prediction.musicxml",
                )
            )

            files: OmrOutputFiles = {
                "xml": str(musicxml_path),
                "raw_prediction": str(prediction_path),
            }
            if abc_path is not None:
                files["abc"] = str(abc_path)

            return OmrSuccessResult(
                success=True,
                engine=self.engine_name,
                files=files,
                stdout=inference.stdout,
                stderr=inference.stderr,
            )
        except subprocess.TimeoutExpired as exc:
            logger.bind(
                event="legato_omr.processing_timeout",
                engine=self.engine_name,
                page_count=len(image_paths),
                timeout_seconds=self.timeout_seconds,
            ).opt(exception=exc).warning("LEGATO OMR processing timed out")
            return self._failure(
                ErrorCode.TASK_TIMEOUT,
                "LEGATO processing timed out",
            )
        except FileNotFoundError as exc:
            logger.bind(
                event="legato_omr.prerequisite_missing",
                engine=self.engine_name,
                exception_type=type(exc).__name__,
            ).opt(exception=exc).warning("LEGATO OMR prerequisite missing")
            return self._failure(
                ErrorCode.SCORE_RECOGNITION_FAILED,
                str(exc),
            )
        except LegatoConversionError as exc:
            logger.bind(
                event="legato_omr.conversion_failed",
                engine=self.engine_name,
                exception_type=type(exc).__name__,
            ).opt(exception=exc).warning("LEGATO OMR conversion failed")
            return self._failure(
                ErrorCode.SCORE_RECOGNITION_FAILED,
                str(exc),
            )
        except Exception as exc:
            logger.bind(
                event="legato_omr.processing_failed",
                engine=self.engine_name,
                exception_type=type(exc).__name__,
            ).opt(exception=exc).error("LEGATO OMR processing failed")
            return self._failure(
                ErrorCode.SCORE_RECOGNITION_FAILED,
                str(exc),
            )

    def _convert_abc_page(self, abc: str, stem: str) -> tuple[Path, Path]:
        abc_path = self.output_folder / f"{stem}.abc"
        cleaned_abc_path = self.output_folder / f"{stem}.cleaned.abc"
        musicxml_path = self.output_folder / f"{stem}.musicxml"

        abc_path.write_text(abc, encoding="utf-8")
        cleaned_abc = self._cleanup_abc(abc)
        cleaned_abc_path.write_text(cleaned_abc, encoding="utf-8")

        conversion = self._run_abc2xml(cleaned_abc, stem)
        if conversion.returncode != 0:
            logger.bind(
                event="legato_omr.abc_to_musicxml_failed",
                engine=self.engine_name,
                stem=stem,
                exit_code=conversion.returncode,
                stderr_tail=conversion.stderr.decode("utf-8", errors="replace")[-1000:],
            ).warning("LEGATO ABC to MusicXML conversion failed")
            raise LegatoConversionError(
                "LEGATO ABC to MusicXML conversion failed: "
                + conversion.stderr.decode("utf-8", errors="replace")[-1000:]
            )

        musicxml_path.write_text(
            conversion.stdout.decode("utf-8", errors="replace"),
            encoding="utf-8",
        )
        normalize_initial_musicxml_clefs(musicxml_path)
        return abc_path, musicxml_path

    def _check_prerequisites(self, image_paths: list[str]) -> None:
        if not self.repo_path:
            raise FileNotFoundError("LEGATO_REPO_PATH is not configured")
        if not self.repo_path.exists():
            raise FileNotFoundError(f"LEGATO repository not found: {self.repo_path}")
        if not (self.repo_path / "legato" / "models").exists():
            raise FileNotFoundError(f"LEGATO package not found: {self.repo_path}")
        if not (self.repo_path / "utils" / "abc2xml.py").exists():
            raise FileNotFoundError("LEGATO abc2xml.py not found")
        if not image_paths:
            raise FileNotFoundError("No input images were provided")
        for image_path in image_paths:
            if not Path(image_path).exists():
                raise FileNotFoundError(f"Input file does not exist: {image_path}")

    def _run_inference(
        self,
        image_paths: list[Path],
        prediction_path: Path,
    ) -> subprocess.CompletedProcess[str]:
        runner_path = self.output_folder / "_legato_inference_runner.py"
        image_list_path = self.output_folder / "image_list.json"
        runner_path.write_text(INFERENCE_RUNNER, encoding="utf-8")
        image_list_path.write_text(
            json.dumps([str(path) for path in image_paths], ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        command = [
            self.python_executable,
            str(runner_path),
            "--model_path",
            self.model_path,
            "--processor_path",
            self.processor_path,
            "--image_list",
            str(image_list_path),
            "--output_path",
            str(prediction_path),
            "--device",
            self.device,
            "--beam_size",
            str(self.beam_size),
            "--batch_size",
            str(self.batch_size),
        ]
        if self.fp16:
            command.append("--fp16")

        env = os.environ.copy()
        current_pythonpath = env.get("PYTHONPATH")
        env["PYTHONPATH"] = (
            str(self.repo_path)
            if not current_pythonpath
            else f"{self.repo_path}{os.pathsep}{current_pythonpath}"
        )
        settings = get_worker_runtime_settings()
        if settings.HF_HOME:
            env["HF_HOME"] = settings.HF_HOME
        if settings.HF_HUB_OFFLINE:
            env["HF_HUB_OFFLINE"] = "1"
        if settings.TRANSFORMERS_OFFLINE:
            env["TRANSFORMERS_OFFLINE"] = "1"

        result = subprocess.run(
            command,
            cwd=str(self.repo_path),
            env=env,
            capture_output=True,
            text=True,
            timeout=self.timeout_seconds,
        )
        (self.output_folder / "legato_stdout.txt").write_text(
            result.stdout,
            encoding="utf-8",
        )
        (self.output_folder / "legato_stderr.txt").write_text(
            result.stderr,
            encoding="utf-8",
        )
        logger.bind(
            event="legato_omr.inference_subprocess_finished",
            engine=self.engine_name,
            exit_code=result.returncode,
            stdout_tail=result.stdout[-1000:],
            stderr_tail=result.stderr[-1000:],
        ).info("LEGATO inference subprocess finished")
        return result

    def _read_abc(self, prediction_path: Path) -> str:
        return self._read_abcs(prediction_path)[0]

    def _read_abcs(self, prediction_path: Path) -> list[str]:
        data = json.loads(prediction_path.read_text(encoding="utf-8"))
        transcriptions = data.get("abc_transcription")
        if not isinstance(transcriptions, list) or not transcriptions:
            raise ValueError("LEGATO prediction is missing abc_transcription")
        abcs: list[str] = []
        for index, abc in enumerate(transcriptions, 1):
            if not isinstance(abc, str) or not abc.strip():
                raise ValueError(f"LEGATO prediction contains empty ABC at page {index}")
            abcs.append(abc)
        return abcs

    def _cleanup_abc(self, abc: str) -> str:
        cleanup_abc = self._load_cleanup_abc()
        return cleanup_abc(abc)

    def _load_cleanup_abc(self) -> Callable[[str], str]:
        convert_path = self.repo_path / "utils" / "convert.py"
        spec = importlib.util.spec_from_file_location("legato_convert", convert_path)
        if spec is None or spec.loader is None:
            raise RuntimeError(f"Could not load LEGATO convert module: {convert_path}")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module.cleanup_abc

    def _run_abc2xml(
        self,
        cleaned_abc: str,
        stem: str = "prediction",
    ) -> subprocess.CompletedProcess[bytes]:
        abc2xml_path = self.repo_path / "utils" / "abc2xml.py"
        result = subprocess.run(
            [self.python_executable, str(abc2xml_path), "-"],
            input=cleaned_abc.encode("utf-8"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=str(self.repo_path),
            timeout=self.timeout_seconds,
        )
        (self.output_folder / f"{stem}.abc2xml_stderr.txt").write_text(
            result.stderr.decode("utf-8", errors="replace"),
            encoding="utf-8",
        )
        return result

    def _merge_musicxml_pages(self, page_xml_paths: list[Path], output_path: Path) -> Path:
        if not page_xml_paths:
            raise ValueError("No MusicXML pages to merge")

        base_tree = ET.parse(page_xml_paths[0])
        base_root = base_tree.getroot()
        base_parts = self._collect_musicxml_parts(base_root)
        base_part_ids = list(base_parts.keys())
        if not base_part_ids:
            raise ValueError(f"No MusicXML parts found in {page_xml_paths[0]}")

        next_measure_number = {
            part_id: len(base_parts[part_id].findall("measure")) + 1
            for part_id in base_part_ids
        }

        for page_index, page_xml_path in enumerate(page_xml_paths[1:], 2):
            page_root = ET.parse(page_xml_path).getroot()
            page_parts = self._collect_musicxml_parts(page_root)
            page_part_ids = list(page_parts.keys())
            if page_part_ids != base_part_ids:
                raise ValueError(
                    "Cannot merge MusicXML pages with different part order: "
                    f"{page_xml_paths[0]} has {base_part_ids}, "
                    f"{page_xml_path} has {page_part_ids}"
                )

            for part_offset, part_id in enumerate(base_part_ids):
                source_part = page_parts[part_id]
                target_part = base_parts[part_id]
                for measure_offset, measure in enumerate(source_part.findall("measure")):
                    copied_measure = copy.deepcopy(measure)
                    copied_measure.set("number", str(next_measure_number[part_id]))
                    if part_offset == 0 and measure_offset == 0:
                        self._add_new_page_print(copied_measure, page_index)
                    target_part.append(copied_measure)
                    next_measure_number[part_id] += 1

        ET.indent(base_root)
        base_tree.write(output_path, encoding="utf-8", xml_declaration=True)
        normalize_initial_musicxml_clefs(output_path)
        return output_path

    @staticmethod
    def _collect_musicxml_parts(root: ET.Element) -> dict[str, ET.Element]:
        parts: dict[str, ET.Element] = {}
        for part in root.findall("part"):
            part_id = part.get("id")
            if part_id:
                parts[part_id] = part
        return parts

    @staticmethod
    def _add_new_page_print(measure: ET.Element, page_index: int) -> None:
        print_element = measure.find("print")
        if print_element is None:
            print_element = ET.Element("print")
            measure.insert(0, print_element)
        print_element.set("new-page", "yes")
        print_element.set("page-number", str(page_index))

    def _failure(
        self,
        code: str,
        error: str,
        stderr: str = "",
    ) -> OmrFailureResult:
        if stderr:
            logger.bind(
                event="legato_omr.failure",
                engine=self.engine_name,
                public_code=code,
                stderr_tail=stderr[-1000:],
            ).warning("LEGATO OMR failure")
        return OmrFailureResult(
            success=False,
            engine=self.engine_name,
            error=error,
            code=code,
        )


INFERENCE_RUNNER = """from __future__ import annotations

import argparse
import json

import torch
from PIL import Image
from transformers import GenerationConfig

from legato.models import LegatoModel
from legato.models.processing_legato import LegatoProcessor


def remove_special_tokens(arrays, special_tokens):
    outputs = []
    for array in arrays:
        outputs.append([tok for tok in array if tok not in special_tokens])
    return outputs


parser = argparse.ArgumentParser()
parser.add_argument("--model_path", required=True)
parser.add_argument("--processor_path", required=True)
parser.add_argument("--image_list", required=True)
parser.add_argument("--output_path", required=True)
parser.add_argument("--device", default="cuda")
parser.add_argument("--beam_size", type=int, default=10)
parser.add_argument("--batch_size", type=int, default=1)
parser.add_argument("--fp16", action="store_true")
args = parser.parse_args()

model = LegatoModel.from_pretrained(args.model_path)
processor = LegatoProcessor.from_pretrained(args.processor_path)
generation_config = GenerationConfig(
    max_length=2048,
    num_beams=args.beam_size,
    repetition_penalty=1.1,
)

with open(args.image_list, "r", encoding="utf-8") as file_handle:
    image_paths = json.load(file_handle)
if not isinstance(image_paths, list) or not image_paths:
    raise ValueError("--image_list must contain a non-empty JSON list")

images = [Image.open(path).convert("RGB") for path in image_paths]
model = model.to(device=args.device)
if args.fp16:
    model = model.half()

output_tokens = []
for start in range(0, len(images), args.batch_size):
    batch_images = images[start:start + args.batch_size]
    inputs = processor(images=batch_images, truncation=True, return_tensors="pt")
    inputs = {key: value.to(args.device) for key, value in inputs.items()}

    with torch.no_grad():
        outputs = model.generate(
            **inputs,
            generation_config=generation_config,
            use_model_defaults=False,
        )

    output_tokens.extend(outputs.tolist())
abc_outputs = processor.batch_decode(output_tokens, skip_special_tokens=True)
special_tokens = processor.tokenizer.all_special_ids
preds = remove_special_tokens(output_tokens, special_tokens)

with open(args.output_path, "w", encoding="utf-8") as file_handle:
    json.dump(
        {"abc_transcription": abc_outputs, "tokens": preds},
        file_handle,
        ensure_ascii=False,
    )

print(f"Inference completed for {len(abc_outputs)} image(s)")
print("Inference completed. Output saved to:", args.output_path)
"""
