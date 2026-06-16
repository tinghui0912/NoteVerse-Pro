"""Rendering helpers for XML image-generation workflows."""
from __future__ import annotations

import os
from typing import List

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.modules.files.render_service import render_and_save_images
from app.shared.file_kinds import FileKind

_IMAGE_TYPE_CONFIG = {
    "preview_image": (FileKind.PREVIEW_IMAGE, "preview", "preview"),
    "final_image": (FileKind.FINAL_IMAGE, "images", "final"),
}


class XMLRenderService:
    """Render XML files into preview or final score image records."""

    async def render_images(
        self,
        db: AsyncSession,
        task_id: int,
        task_uuid: str,
        xml_path: str,
        image_type: str,
    ) -> List[str]:
        config = _IMAGE_TYPE_CONFIG.get(image_type)
        if not config:
            return []

        image_kind, work_subdir, output_name = config
        image_dir = os.path.join(settings.WORK_ROOT, task_uuid, work_subdir)

        rendered = await render_and_save_images(
            db,
            task_id,
            xml_path,
            image_kind,
            image_dir,
            output_name,
        )
        await db.commit()
        return rendered


xml_render_service = XMLRenderService()
