"""Audiveris CLI wrapper for optical music recognition."""

import glob
import os
import subprocess
from typing import Optional, TypedDict

from celery.utils.log import get_task_logger

from app.core.config import settings

logger = get_task_logger(__name__)


class AudiverisOutputFiles(TypedDict, total=False):
    """Successful Audiveris output file locations."""

    mxl: str
    xml: str


class AudiverisSuccessResult(TypedDict):
    """Successful Audiveris engine result."""

    success: bool
    files: AudiverisOutputFiles
    stdout: str
    stderr: str


class AudiverisFailureResult(TypedDict):
    """Failed Audiveris engine result."""

    success: bool
    error: str
    code: str


AudiverisResult = AudiverisSuccessResult | AudiverisFailureResult


class AudiverisEngine:
    """Run Audiveris against score images or PDFs."""

    def __init__(
        self,
        audiveris_path: Optional[str] = None,
        output_folder: Optional[str] = None,
        timeout_seconds: Optional[int] = None,
    ):
        """Initialize the engine from explicit arguments or app settings."""
        self.audiveris_path = audiveris_path or settings.AUDIVERIS_PATH
        self.output_folder = output_folder or settings.WORK_ROOT
        self.timeout_seconds = timeout_seconds or int(settings.MAX_PROCESSING_TIME)

        if not self.audiveris_path:
            raise ValueError("AUDIVERIS_PATH not configured in settings")

    def _check_prerequisites(self, input_path: Optional[str] = None) -> None:
        """Validate executable and input-path availability."""
        if not os.path.exists(self.audiveris_path):
            raise FileNotFoundError("Audiveris executable is not installed")

        if input_path and not os.path.exists(input_path):
            raise FileNotFoundError("Input file does not exist")

    def _build_command(self, input_path: str, use_chinese_ocr: bool = True) -> list:
        """Construct the Audiveris CLI command."""
        cmd = [
            self.audiveris_path,
            "-batch",
            "-transcribe",
            "-export",
            "-output",
            os.path.abspath(self.output_folder),
        ]

        if use_chinese_ocr:
            cmd.extend(
                [
                    "-constant",
                    "OCR_LANGUAGES=chi_sim",
                    "-constant",
                    "TEXT_RECOGNITION=true",
                ]
            )

        cmd.append(os.path.abspath(input_path))
        return cmd

    def _run_command(self, cmd: list) -> subprocess.CompletedProcess:
        """Run the Audiveris subprocess."""
        logger.info(f"Executing Audiveris: {' '.join(cmd)}")

        creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0

        return subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=self.timeout_seconds,
            cwd=self.output_folder,
            creationflags=creationflags,
        )

    def _find_output_mxl(self) -> Optional[str]:
        """Locate the generated MXL file, if any."""
        mxls = glob.glob(os.path.join(self.output_folder, "*.mxl"))
        return mxls[0] if mxls else None

    def _handle_result(self, result: subprocess.CompletedProcess[str]) -> AudiverisResult:
        """Translate subprocess output into the engine result payload."""
        if result.stdout:
            logger.info(f"Audiveris stdout: {result.stdout[:500]}")
        if result.stderr:
            logger.warning(f"Audiveris stderr: {result.stderr[:500]}")
        logger.info(f"Audiveris return code: {result.returncode}")

        mxl_path = self._find_output_mxl()
        if not mxl_path:
            return {
                "success": False,
                "error": "Audiveris processing failed",
                "code": "audiveris_failed",
            }

        return {
            "success": True,
            "files": {"mxl": mxl_path},
            "stdout": result.stdout,
            "stderr": result.stderr,
        }

    def process_image(
        self,
        image_path: str,
        output_name: Optional[str] = None,
    ) -> AudiverisResult:
        """Process a single image and generate MusicXML/MXL output."""
        try:
            self._check_prerequisites(image_path)
            os.makedirs(self.output_folder, exist_ok=True)

            cmd = self._build_command(image_path, use_chinese_ocr=True)
            result = self._run_command(cmd)
            return self._handle_result(result)

        except subprocess.TimeoutExpired:
            logger.error("Audiveris processing timeout")
            return {
                "success": False,
                "error": "Audiveris processing timed out",
                "code": "task_timeout",
            }
        except FileNotFoundError as exc:
            logger.error(f"Audiveris error: {exc}")
            error_msg = str(exc)
            if "Audiveris executable" in error_msg:
                return {"success": False, "error": error_msg, "code": "audiveris_missing"}
            return {"success": False, "error": error_msg, "code": "file_not_found"}
        except Exception as exc:
            logger.error(f"Audiveris processing error: {exc}")
            return {
                "success": False,
                "error": "Audiveris processing failed",
                "code": "audiveris_failed",
            }

    def process_pdf(self, pdf_path: str) -> AudiverisResult:
        """Process a PDF and generate MusicXML/MXL output."""
        try:
            self._check_prerequisites(pdf_path)
            os.makedirs(self.output_folder, exist_ok=True)

            # PDF mode skips Chinese OCR to avoid unstable CLI behavior.
            cmd = self._build_command(pdf_path, use_chinese_ocr=False)
            result = self._run_command(cmd)
            return self._handle_result(result)

        except subprocess.TimeoutExpired:
            logger.error("Audiveris processing timeout")
            return {
                "success": False,
                "error": "Audiveris processing timed out",
                "code": "task_timeout",
            }
        except FileNotFoundError as exc:
            logger.error(f"Audiveris error: {exc}")
            error_msg = str(exc)
            if "Audiveris executable" in error_msg:
                return {"success": False, "error": error_msg, "code": "audiveris_missing"}
            return {"success": False, "error": error_msg, "code": "file_not_found"}
        except Exception as exc:
            logger.error(f"Audiveris processing error: {exc}")
            return {
                "success": False,
                "error": "Audiveris processing failed",
                "code": "audiveris_failed",
            }

    def is_available(self) -> bool:
        """Return whether the Audiveris executable is available."""
        return os.path.exists(self.audiveris_path)

    def get_version(self) -> Optional[str]:
        """Return the Audiveris version string when available."""
        try:
            result = subprocess.run(
                [self.audiveris_path, "-version"],
                capture_output=True,
                text=True,
                timeout=10,
            )
            return result.stdout.strip() if result.returncode == 0 else None
        except Exception:
            return None
