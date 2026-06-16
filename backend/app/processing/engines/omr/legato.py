"""LEGATO implementation of the generic OMR engine contract."""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import subprocess
from typing import Callable

from celery.utils.log import get_task_logger

from app.core.config import settings
from app.processing.musicxml import normalize_initial_musicxml_clefs
from app.shared.constants import ErrorCode

from .base import OmrFailureResult, OmrResult, OmrSuccessResult

logger = get_task_logger(__name__)


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
    ) -> None:
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

    def process_image(self, image_path: str) -> OmrResult:
        try:
            self._check_prerequisites(image_path)
            self.output_folder.mkdir(parents=True, exist_ok=True)

            prediction_path = self.output_folder / "prediction_abc.json"
            abc_path = self.output_folder / "prediction.abc"
            cleaned_abc_path = self.output_folder / "prediction.cleaned.abc"
            musicxml_path = self.output_folder / "prediction.musicxml"

            inference = self._run_inference(Path(image_path), prediction_path)
            if inference.returncode != 0:
                return self._failure(
                    ErrorCode.LEGATO_INFERENCE_FAILED,
                    "LEGATO inference failed",
                    inference.stderr,
                )

            abc = self._read_abc(prediction_path)
            abc_path.write_text(abc, encoding="utf-8")

            cleaned_abc = self._cleanup_abc(abc)
            cleaned_abc_path.write_text(cleaned_abc, encoding="utf-8")

            conversion = self._run_abc2xml(cleaned_abc)
            if conversion.returncode != 0:
                return self._failure(
                    ErrorCode.LEGATO_CONVERSION_FAILED,
                    "LEGATO ABC to MusicXML conversion failed",
                    conversion.stderr.decode("utf-8", errors="replace"),
                )

            musicxml_path.write_text(
                conversion.stdout.decode("utf-8", errors="replace"),
                encoding="utf-8",
            )
            normalize_initial_musicxml_clefs(musicxml_path)

            return OmrSuccessResult(
                success=True,
                engine=self.engine_name,
                files={
                    "xml": str(musicxml_path),
                    "abc": str(abc_path),
                    "raw_prediction": str(prediction_path),
                },
                stdout=inference.stdout,
                stderr=inference.stderr,
            )
        except subprocess.TimeoutExpired:
            return self._failure(
                ErrorCode.TASK_TIMEOUT,
                "LEGATO processing timed out",
            )
        except FileNotFoundError as exc:
            return self._failure(
                ErrorCode.LEGATO_MISSING,
                str(exc),
            )
        except Exception as exc:
            logger.exception("LEGATO processing failed")
            return self._failure(
                ErrorCode.LEGATO_FAILED,
                str(exc),
            )

    def process_pdf(self, pdf_path: str) -> OmrResult:
        return self._failure(
            ErrorCode.LEGATO_MULTI_PAGE_NOT_SUPPORTED,
            "LEGATO PDF/multi-page processing is not supported yet",
        )

    def _check_prerequisites(self, image_path: str) -> None:
        if not self.repo_path:
            raise FileNotFoundError("LEGATO_REPO_PATH is not configured")
        if not self.repo_path.exists():
            raise FileNotFoundError(f"LEGATO repository not found: {self.repo_path}")
        if not (self.repo_path / "legato" / "models").exists():
            raise FileNotFoundError(f"LEGATO package not found: {self.repo_path}")
        if not (self.repo_path / "utils" / "abc2xml.py").exists():
            raise FileNotFoundError("LEGATO abc2xml.py not found")
        if not Path(image_path).exists():
            raise FileNotFoundError(f"Input file does not exist: {image_path}")

    def _run_inference(
        self,
        image_path: Path,
        prediction_path: Path,
    ) -> subprocess.CompletedProcess[str]:
        runner_path = self.output_folder / "_legato_inference_runner.py"
        runner_path.write_text(INFERENCE_RUNNER, encoding="utf-8")

        command = [
            self.python_executable,
            str(runner_path),
            "--model_path",
            self.model_path,
            "--processor_path",
            self.processor_path,
            "--image_path",
            str(image_path),
            "--output_path",
            str(prediction_path),
            "--device",
            self.device,
            "--beam_size",
            str(self.beam_size),
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
        return result

    def _read_abc(self, prediction_path: Path) -> str:
        data = json.loads(prediction_path.read_text(encoding="utf-8"))
        transcriptions = data.get("abc_transcription")
        if not isinstance(transcriptions, list) or not transcriptions:
            raise ValueError("LEGATO prediction is missing abc_transcription")
        abc = transcriptions[0]
        if not isinstance(abc, str) or not abc.strip():
            raise ValueError("LEGATO prediction contains empty ABC")
        return abc

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

    def _run_abc2xml(self, cleaned_abc: str) -> subprocess.CompletedProcess[bytes]:
        abc2xml_path = self.repo_path / "utils" / "abc2xml.py"
        result = subprocess.run(
            [self.python_executable, str(abc2xml_path), "-"],
            input=cleaned_abc.encode("utf-8"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=str(self.repo_path),
            timeout=self.timeout_seconds,
        )
        (self.output_folder / "abc2xml_stderr.txt").write_text(
            result.stderr.decode("utf-8", errors="replace"),
            encoding="utf-8",
        )
        return result

    def _failure(
        self,
        code: str,
        error: str,
        stderr: str = "",
    ) -> OmrFailureResult:
        if stderr:
            logger.warning(f"LEGATO error [{code}]: {stderr[-1000:]}")
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
parser.add_argument("--image_path", required=True)
parser.add_argument("--output_path", required=True)
parser.add_argument("--device", default="cuda")
parser.add_argument("--beam_size", type=int, default=10)
parser.add_argument("--fp16", action="store_true")
args = parser.parse_args()

model = LegatoModel.from_pretrained(args.model_path)
processor = LegatoProcessor.from_pretrained(args.processor_path)
generation_config = GenerationConfig(
    max_length=2048,
    num_beams=args.beam_size,
    repetition_penalty=1.1,
)

image = Image.open(args.image_path).convert("RGB")
model = model.to(device=args.device)
if args.fp16:
    model = model.half()

inputs = processor(images=[image], truncation=True, return_tensors="pt")
inputs = {key: value.to(args.device) for key, value in inputs.items()}

with torch.no_grad():
    outputs = model.generate(
        **inputs,
        generation_config=generation_config,
        use_model_defaults=False,
    )

output_tokens = outputs.tolist()
abc_outputs = processor.batch_decode(output_tokens, skip_special_tokens=True)
special_tokens = processor.tokenizer.all_special_ids
preds = remove_special_tokens(output_tokens, special_tokens)

with open(args.output_path, "w", encoding="utf-8") as file_handle:
    json.dump(
        {"abc_transcription": abc_outputs, "tokens": preds},
        file_handle,
        ensure_ascii=False,
    )

print(abc_outputs[0])
print("Inference completed. Output saved to:", args.output_path)
"""
