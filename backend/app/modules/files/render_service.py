"""Rendering helpers for file/image generation workflows."""

import os
from typing import List

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ScoreRenderFailedException
from app.core.logger import logger
from app.db.models import File as FileModel
from app.processing.engines.render import create_score_render_engine
from app.storage import file_storage
from app.shared.constants import ErrorCode
from app.shared.file_kinds import FileKind


async def render_and_save_images(
    db: AsyncSession,
    task_id: int,
    xml_path: str,
    image_kind: str | FileKind,
    output_dir: str,
    output_name: str,
) -> List[str]:
    """Render an XML file to images and persist file records."""
    rendered_images: List[str] = []
    normalized_image_kind = _kind_value(image_kind)

    os.makedirs(output_dir, exist_ok=True)

    try:
        engine = create_score_render_engine(
            output_folder=output_dir,
        )
        result = engine.render_score(
            xml_path=xml_path,
            output_name=output_name,
            output_format="svg" if engine.engine_name == "verovio" else "png",
        )

        if result.get("success"):
            files = result["files"]
            if not files:
                raise ScoreRenderFailedException(
                    details={
                        "engine": result.get("engine"),
                        "error": "Score renderer completed without output files",
                    }
                )

            old_records_result = await db.execute(
                select(FileModel).where(
                    FileModel.task_id == task_id,
                    FileModel.kind == normalized_image_kind,
                )
            )
            old_storage_keys = {
                file.storage_key for file in old_records_result.scalars().all()
            }
            for storage_key in old_storage_keys:
                try:
                    file_storage.delete(storage_key)
                except Exception as exc:
                    logger.warning(
                        f"Failed to delete stale rendered image {storage_key}: {exc}"
                    )

            await db.execute(
                delete(FileModel).where(
                    FileModel.task_id == task_id,
                    FileModel.kind == normalized_image_kind,
                )
            )

            for file_info in files:
                img_path = file_info["path"]
                storage_key = _store_rendered_image(
                    task_id,
                    normalized_image_kind,
                    img_path,
                    file_info["page"],
                    file_info["mime_type"],
                )
                db.add(
                    FileModel(
                        task_id=task_id,
                        kind=normalized_image_kind,
                        storage_backend=file_storage.backend_name,
                        storage_key=storage_key,
                        filename=os.path.basename(storage_key),
                        page_number=file_info["page"],
                        mime_type=file_info["mime_type"],
                        size_bytes=(
                            os.path.getsize(img_path) if os.path.exists(img_path) else None
                        ),
                    )
                )
                rendered_images.append(storage_key)

            logger.info(
                f"Rendered {len(files)} images for task {task_id} with {result['engine']}"
            )
            return rendered_images

        raise ScoreRenderFailedException(
            code=str(result.get("code") or ErrorCode.SCORE_RENDER_FAILED),
            details={
                "engine": result.get("engine"),
                "error": result.get("error"),
            },
        )
    except ScoreRenderFailedException:
        raise
    except Exception as exc:
        logger.error(f"Image rendering failed: {exc}")
        raise ScoreRenderFailedException(
            details={"error": str(exc)}
        ) from exc


def _store_rendered_image(
    task_id: int,
    image_kind: str | FileKind,
    img_path: str,
    page: int,
    mime_type: str,
) -> str:
    normalized_image_kind = _kind_value(image_kind)
    key = (
        f"tasks/{_infer_task_uuid_from_path(img_path, fallback=str(task_id))}/"
        f"{normalized_image_kind}/{page:03d}-{os.path.basename(img_path)}"
    )
    with open(img_path, "rb") as file_handle:
        stored = file_storage.put_bytes(
            key=key,
            content=file_handle.read(),
            content_type=mime_type,
        )
    return stored.storage_key


def _kind_value(kind: str | FileKind) -> str:
    """Normalize FileKind enum values before using them in storage keys."""

    return kind.value if isinstance(kind, FileKind) else str(kind)


def _infer_task_uuid_from_path(path: str, *, fallback: str) -> str:
    parts = os.path.normpath(path).split(os.sep)
    for marker in ("work",):
        if marker in parts:
            index = parts.index(marker)
            if index + 1 < len(parts):
                return parts[index + 1]
    return fallback
