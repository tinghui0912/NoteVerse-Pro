"""Text recognition and classification based on PaddleOCR results."""

import os
import re
from typing import Iterable, List, Literal, Optional, TypedDict

from app.core.logger import logger
from app.processing.engines.paddle import run_ocr_subprocess

from .config import ClassificationConfig, OCR_CORRECTIONS, OcrConfig

OCRPoint = tuple[float, float]
OCRBoundingBox = list[OCRPoint]


class RecognizedText(TypedDict):
    text: str
    confidence: float
    bbox: OCRBoundingBox | None
    center_x: float
    center_y: float
    width: float
    height: float


class OtherTextInfo(TypedDict):
    text: str
    confidence: float
    position: str
    relative_y: float


class ClassifiedTexts(TypedDict):
    title: Optional[str]
    subtitle: Optional[str]
    composer: Optional[str]
    lyricist: Optional[str]
    copyright: Optional[str]
    other_texts: List[OtherTextInfo]


class TextRecognitionFailureResult(TypedDict):
    success: Literal[False]
    error: str
    texts: List[RecognizedText]


class TextRecognitionSuccessResult(TypedDict):
    success: Literal[True]
    texts: List[RecognizedText]
    total_count: int


class TextRecognitionProcessSuccessResult(TypedDict):
    success: Literal[True]
    raw_texts: List[RecognizedText]
    classified_texts: ClassifiedTexts
    total_count: int


class TextRecognitionProcessFailureResult(TypedDict):
    success: Literal[False]
    error: str
    texts: List[RecognizedText]


class TextRecognitionEngine:
    """Recognize text in score images and classify the extracted fields."""

    def _post_process_ocr_text(self, text: str) -> str:
        """Apply OCR cleanup rules to a single recognized text string."""
        if not text:
            return text

        result = text
        has_copyright_context = any(
            keyword.lower() in result.lower()
            for keyword in ClassificationConfig.COPYRIGHT_CONTEXT_KEYWORDS
        )

        if has_copyright_context:
            result = re.sub(r"(?<![a-zA-Z0-9])@(?![a-zA-Z])", "©", result)

        for wrong, correct in OCR_CORRECTIONS.items():
            result = result.replace(wrong, correct)

        if result != text:
            logger.bind(
                event="text_recognition.ocr_text_corrected",
                original_length=len(text),
                corrected_length=len(result),
            ).debug("OCR text post-processing correction applied")

        return result

    def _post_process_texts(self, texts: List[RecognizedText]) -> List[RecognizedText]:
        """Apply OCR cleanup rules to the full text-region list."""
        for text_info in texts:
            if "text" in text_info:
                text_info["text"] = self._post_process_ocr_text(text_info["text"])
        return texts

    @staticmethod
    def _normalize_bbox(raw_bbox: object) -> OCRBoundingBox | None:
        """Normalize OCR polygon data into a list of float coordinate pairs."""
        if raw_bbox is None or not hasattr(raw_bbox, "__len__") or len(raw_bbox) < 4:
            return None

        bbox_source = raw_bbox.tolist() if hasattr(raw_bbox, "tolist") else raw_bbox
        if not isinstance(bbox_source, Iterable):
            return None

        normalized: OCRBoundingBox = []
        for point in bbox_source:
            if not isinstance(point, Iterable):
                return None
            coords = list(point)
            if len(coords) < 2:
                return None
            try:
                normalized.append((float(coords[0]), float(coords[1])))
            except (TypeError, ValueError):
                return None

        return normalized or None

    def recognize_text(
        self,
        image_path: str,
        timeout_seconds: int | None = None,
    ) -> TextRecognitionSuccessResult | TextRecognitionFailureResult:
        """Recognize text regions from an image."""
        try:
            if not os.path.exists(image_path):
                return {
                    "success": False,
                    "error": f"Image file does not exist: {image_path}",
                    "texts": [],
                }

            logger.bind(
                event="text_recognition.started",
                image_path=image_path,
                timeout_seconds=timeout_seconds,
            ).info("Text recognition started")

            process_result = run_ocr_subprocess(image_path, timeout_seconds=timeout_seconds)
            if not process_result["success"]:
                logger.bind(
                    event="text_recognition.subprocess_failed",
                    image_path=image_path,
                    error_code=process_result.get("code"),
                    internal_reason=process_result.get("error"),
                ).warning("Text recognition subprocess failed")
                return {
                    "success": False,
                    "error": process_result["error"],
                    "texts": [],
                }

            result = process_result["result"]
            texts: List[RecognizedText] = []
            if result and len(result) > 0 and result[0]:
                ocr_result = result[0]

                if isinstance(ocr_result, dict):
                    rec_texts = ocr_result.get("rec_texts", [])
                    rec_scores = ocr_result.get("rec_scores", [])
                    rec_polys = ocr_result.get("rec_polys", [])

                    logger.bind(
                        event="text_recognition.ocr_regions_detected",
                        image_path=image_path,
                        region_count=len(rec_texts),
                        payload_shape="dict",
                    ).info("OCR text regions detected")

                    for idx, (text_content, confidence) in enumerate(zip(rec_texts, rec_scores)):
                        if not text_content or confidence <= OcrConfig.MIN_CONFIDENCE_THRESHOLD:
                            continue

                        bbox_list = self._normalize_bbox(
                            rec_polys[idx] if idx < len(rec_polys) else None
                        )

                        if bbox_list:
                            x_coords = [point[0] for point in bbox_list]
                            y_coords = [point[1] for point in bbox_list]
                            center_x = sum(x_coords) / len(x_coords)
                            center_y = sum(y_coords) / len(y_coords)
                            width = max(x_coords) - min(x_coords)
                            height = max(y_coords) - min(y_coords)
                        else:
                            center_x = center_y = width = height = 0

                        texts.append(
                            {
                                "text": text_content,
                                "confidence": float(confidence),
                                "bbox": bbox_list,
                                "center_x": center_x,
                                "center_y": center_y,
                                "width": width,
                                "height": height,
                            }
                        )

                elif isinstance(ocr_result, list):
                    logger.bind(
                        event="text_recognition.ocr_rows_detected",
                        image_path=image_path,
                        row_count=len(ocr_result),
                        payload_shape="list",
                    ).info("OCR rows detected")

                    for line in ocr_result:
                        if not line or len(line) < 2:
                            continue

                        try:
                            bbox = line[0]
                            text_info = line[1]

                            if not isinstance(text_info, (list, tuple)) or len(text_info) < 2:
                                logger.bind(
                                    event="text_recognition.invalid_text_payload",
                                    image_path=image_path,
                                    row_index=len(texts),
                                    payload_type=type(text_info).__name__,
                                ).warning("Invalid OCR text payload")
                                continue

                            text_content = text_info[0]
                            confidence = text_info[1]

                            if not text_content or confidence <= OcrConfig.MIN_CONFIDENCE_THRESHOLD:
                                continue

                            bbox_list = self._normalize_bbox(bbox)
                            if bbox_list:
                                x_coords = [point[0] for point in bbox_list]
                                y_coords = [point[1] for point in bbox_list]
                                center_x = sum(x_coords) / len(x_coords)
                                center_y = sum(y_coords) / len(y_coords)
                                width = max(x_coords) - min(x_coords)
                                height = max(y_coords) - min(y_coords)
                            else:
                                center_x = center_y = width = height = 0

                            texts.append(
                                {
                                    "text": text_content,
                                    "confidence": float(confidence),
                                    "bbox": bbox_list,
                                    "center_x": center_x,
                                    "center_y": center_y,
                                    "width": width,
                                    "height": height,
                                }
                            )
                        except Exception as exc:
                            logger.bind(
                                event="text_recognition.row_parse_failed",
                                image_path=image_path,
                                exception_type=type(exc).__name__,
                            ).opt(exception=exc).warning("Failed to parse OCR result row")
                            continue

            texts = self._post_process_texts(texts)
            logger.bind(
                event="text_recognition.completed",
                image_path=image_path,
                text_count=len(texts),
            ).info("Text recognition completed")

            return {"success": True, "texts": texts, "total_count": len(texts)}
        except Exception as exc:
            logger.bind(
                event="text_recognition.failed",
                image_path=image_path,
                exception_type=type(exc).__name__,
            ).opt(exception=exc).error("Text recognition failed")
            return {"success": False, "error": str(exc), "texts": []}

    def classify_texts(self, texts: List[RecognizedText]) -> ClassifiedTexts:
        """Classify recognized text into title, creators, copyright, and others."""
        result: ClassifiedTexts = {
            "title": None,
            "subtitle": None,
            "composer": None,
            "lyricist": None,
            "copyright": None,
            "other_texts": [],
        }

        if not texts:
            return result

        max_y = max(text["center_y"] for text in texts)
        min_y = min(text["center_y"] for text in texts)
        sorted_texts = sorted(texts, key=lambda item: item["center_y"])

        for idx, text_info in enumerate(sorted_texts):
            text = text_info["text"].strip()
            confidence = text_info["confidence"]

            logger.bind(
                event="text_recognition.text_classification_item",
                text_index=idx,
                text_length=len(text),
                confidence=round(confidence, 3),
            ).debug("Classifying recognized text item")

            if confidence < OcrConfig.CLASSIFICATION_CONFIDENCE_THRESHOLD:
                continue

            y_position = text_info["center_y"]
            relative_y = (y_position - min_y) / (max_y - min_y) if max_y > min_y else 0

            if relative_y < ClassificationConfig.TITLE_POSITION_THRESHOLD and not result["title"]:
                if len(text) > 1 and not self._looks_like_title_excluded_metadata(text):
                    result["title"] = text
                    continue
            elif (
                relative_y < ClassificationConfig.SUBTITLE_POSITION_THRESHOLD
                and result["title"]
                and not result["subtitle"]
            ):
                if len(text) > 1 and not self._looks_like_title_excluded_metadata(text):
                    result["subtitle"] = text
                    continue

            has_composer_kw = any(
                keyword in text for keyword in ClassificationConfig.COMPOSER_KEYWORDS
            )
            has_lyricist_kw = any(
                keyword in text for keyword in ClassificationConfig.LYRICIST_KEYWORDS
            )

            if has_composer_kw:
                if not result["composer"]:
                    result["composer"] = text
                    continue
            elif has_lyricist_kw:
                if not result["lyricist"]:
                    result["lyricist"] = text
                    continue

            result["other_texts"].append(
                {
                    "text": text,
                    "confidence": confidence,
                    "position": f"({text_info['center_x']:.0f}, {text_info['center_y']:.0f})",
                    "relative_y": relative_y,
                }
            )

        result["copyright"] = self._extract_copyright_from_texts(texts, min_y, max_y)
        if result["copyright"]:
            logger.bind(
                event="text_recognition.copyright_detected",
            ).info("Copyright text detected")

        return result

    def _looks_like_title_excluded_metadata(self, text: str) -> bool:
        """Return true for metadata labels, without excluding normal title words."""

        value = text.strip().lower()
        separators = set(ClassificationConfig.TITLE_METADATA_LABEL_SEPARATORS)
        metadata_keywords = ClassificationConfig.TITLE_METADATA_LABEL_KEYWORDS
        always_excluded = {
            keyword.strip().lower()
            for keyword in ClassificationConfig.TITLE_ALWAYS_EXCLUDE_KEYWORDS
            if keyword.strip()
        }

        for keyword in metadata_keywords:
            normalized = keyword.strip().lower()
            if not normalized:
                continue

            if normalized in always_excluded:
                if normalized in value:
                    return True
                continue

            if not value.startswith(normalized):
                continue

            suffix = value[len(normalized):]
            if not suffix:
                return True
            if suffix[0] in separators:
                return True

        return False

    def _extract_copyright_from_texts(
        self,
        texts: List[RecognizedText],
        min_y: float,
        max_y: float,
    ) -> Optional[str]:
        """Extract copyright text from lower-page OCR regions."""
        if not texts:
            return None

        bottom_texts: List[RecognizedText] = []
        for text_info in texts:
            y_position = text_info.get("center_y", 0)
            relative_y = (y_position - min_y) / (max_y - min_y) if max_y > min_y else 0
            if relative_y > ClassificationConfig.BOTTOM_TEXT_THRESHOLD:
                bottom_texts.append(text_info)

        if not bottom_texts:
            return None

        copyright_texts: List[str] = []
        for text_info in bottom_texts:
            text = text_info.get("text", "").strip()
            if any(
                keyword.lower() in text.lower()
                for keyword in ClassificationConfig.COPYRIGHT_KEYWORDS
            ):
                copyright_texts.append(text)

        if not copyright_texts:
            return None

        if len(copyright_texts) > 1:
            return "\n".join(copyright_texts)

        one = copyright_texts[0]
        for keyword in ClassificationConfig.COPYRIGHT_SPLIT_MARKERS:
            idx = one.find(keyword)
            if idx > 0:
                return one[:idx].rstrip() + "\n" + one[idx:].lstrip()

        pos = one.find("版权所有")
        if pos >= 0:
            end = pos + len("版权所有")
            if end < len(one):
                return one[:end].rstrip() + "\n" + one[end:].lstrip()

        return one

    def process_image(
        self,
        image_path: str,
        timeout_seconds: int | None = None,
    ) -> TextRecognitionProcessSuccessResult | TextRecognitionProcessFailureResult:
        """Run OCR and return raw plus classified text results."""
        recognition_result = self.recognize_text(image_path, timeout_seconds=timeout_seconds)
        if not recognition_result["success"]:
            return {
                "success": False,
                "error": recognition_result["error"],
                "texts": recognition_result["texts"],
            }

        classified_texts = self.classify_texts(recognition_result["texts"])
        return {
            "success": True,
            "raw_texts": recognition_result["texts"],
            "classified_texts": classified_texts,
            "total_count": recognition_result["total_count"],
        }
