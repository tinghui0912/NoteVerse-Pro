"""Rendering helpers for file/image generation workflows."""

import glob
import os
from typing import List

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logger import logger
from app.db.models import File as FileModel
from app.utils.paths import to_rel_storage


async def render_and_save_images(
    db: AsyncSession,
    task_id: int,
    xml_path: str,
    image_kind: str,
    output_dir: str,
    output_name: str,
    dpi: int = 300,
) -> List[str]:
    """Render an XML file to images and persist file records."""
    from app.processing.engines.musescore import MuseScoreEngine

    rendered_images: List[str] = []
    musescore_path = settings.MUSESCORE_PATH
    if not musescore_path or not os.path.exists(musescore_path):
        logger.warning("MuseScore not found, skipping render")
        return rendered_images

    os.makedirs(output_dir, exist_ok=True)

    try:
        engine = MuseScoreEngine(
            musescore_path=musescore_path,
            output_folder=output_dir,
        )
        result = engine.render_to_image(
            xml_path=xml_path,
            output_name=output_name,
            format="png",
            dpi=dpi,
        )

        if result.get("success"):
            pattern = os.path.join(output_dir, f"{output_name}-*.png")
            images = sorted(glob.glob(pattern))
            if not images:
                single = os.path.join(output_dir, f"{output_name}.png")
                if os.path.exists(single):
                    images = [single]

            if images:
                await db.execute(
                    delete(FileModel).where(
                        FileModel.task_id == task_id,
                        FileModel.kind == image_kind,
                    )
                )

                for index, img_path in enumerate(images, 1):
                    rel_path = to_rel_storage(img_path)
                    db.add(
                        FileModel(
                            task_id=task_id,
                            kind=image_kind,
                            path=rel_path,
                            page=index,
                            mime_type="image/png",
                            dpi=dpi,
                        )
                    )
                    rendered_images.append(rel_path)

                logger.info(f"Rendered {len(images)} images for task {task_id}")
        else:
            logger.warning(f"MuseScore rendering failed: {result.get('error')}")
    except Exception as exc:
        logger.error(f"Image rendering failed: {exc}")

    return rendered_images
