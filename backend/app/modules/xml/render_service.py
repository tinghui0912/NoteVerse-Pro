"""Rendering helpers for XML image-generation workflows."""
from __future__ import annotations

import glob
import os
import shutil
from typing import List

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models import Task
from app.db.models.file import File
from app.modules.files.render_service import render_and_save_images
from app.modules.xml.schemas import XMLImageItem
from app.shared.file_kinds import FileKind
from app.utils.paths import to_rel_storage

_IMAGE_TYPE_CONFIG = {
    "preview_image": (FileKind.PREVIEW_IMAGE, "temp", "preview"),
    "final_image": (FileKind.FINAL_IMAGE, "output", "final"),
}


class XMLRenderService:
    """Support image rendering and preview-to-final fallback for XML flows."""

    async def render_images(
        self,
        db: AsyncSession,
        task_id: int,
        task_uuid: str,
        xml_path: str,
        image_type: str,
        dpi: int,
    ) -> List[str]:
        config = _IMAGE_TYPE_CONFIG.get(image_type)
        if not config:
            return []

        image_kind, dir_type, output_name = config
        if dir_type == "temp":
            image_dir = os.path.join(settings.TEMP_FOLDER, task_uuid, "preview")
        else:
            image_dir = os.path.join(settings.OUTPUT_FOLDER, task_uuid, "images")

        rendered = await render_and_save_images(
            db,
            task_id,
            xml_path,
            image_kind,
            image_dir,
            output_name,
            dpi=dpi,
        )
        await db.commit()
        return rendered

    async def fallback_preview_to_final(
        self,
        db: AsyncSession,
        task: Task,
        task_uuid: str,
        dpi: int,
    ) -> List[XMLImageItem]:
        preview_dir = os.path.join(settings.TEMP_FOLDER, task_uuid, "preview")
        final_image_dir = os.path.join(settings.OUTPUT_FOLDER, task_uuid, "images")
        final_images: List[XMLImageItem] = []

        if not os.path.exists(preview_dir):
            return final_images

        os.makedirs(final_image_dir, exist_ok=True)
        preview_files = sorted(glob.glob(os.path.join(preview_dir, "*.png")))

        await db.execute(
            delete(File).where(
                File.task_id == task.id,
                File.kind == FileKind.FINAL_IMAGE,
            )
        )

        for index, src in enumerate(preview_files, 1):
            dst = os.path.join(final_image_dir, f"page-{index:02d}.png")
            shutil.copy2(src, dst)
            db.add(
                File(
                    task_id=task.id,
                    kind=FileKind.FINAL_IMAGE,
                    path=to_rel_storage(dst),
                    page=index,
                    dpi=dpi,
                    size_bytes=os.path.getsize(dst),
                    mime_type="image/png",
                )
            )
            final_images.append({"path": to_rel_storage(dst), "page": index})

        return final_images


xml_render_service = XMLRenderService()
