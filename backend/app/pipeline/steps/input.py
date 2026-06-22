"""Input-copy steps for single-image and multi-image tasks."""

import os
import shutil
from typing import List

from celery.utils.log import get_task_logger

from app.core.exceptions import FileNotFoundException

from ..base import Step
from ..context import JobContext

logger = get_task_logger(__name__)


class CopyImageStep(Step):
    """Copy a single input image into the task working directory."""

    name = "copy_input"
    progress_start = 2
    progress_end = 5

    def run(self, ctx: JobContext) -> None:
        logger.info(f"[{ctx.job_id}] Starting input copy")

        ctx.create_dirs()

        image_path = ctx.image_paths[0]
        abs_path = os.path.abspath(image_path)

        if not os.path.exists(abs_path):
            raise FileNotFoundException(details={"path": image_path})

        ext = os.path.splitext(abs_path)[1].lower() or ".png"
        dst = os.path.join(ctx.raw_dir, f"1{ext}")

        try:
            shutil.copy2(abs_path, dst)
        except Exception as exc:
            logger.debug(f"[{ctx.job_id}] copy2 failed for {abs_path}, using stream copy: {exc}")
            with open(abs_path, "rb") as rf, open(dst, "wb") as wf:
                wf.write(rf.read())

        ctx.raw_paths = [dst]

        from app.shared.file_kinds import FileKind
        from app.pipeline.files_recorder import replace_files

        replace_files(ctx.job_id, FileKind.ORIGINAL_IMAGE, [os.path.abspath(dst)])

        logger.info(f"[{ctx.job_id}] Input copy completed: {dst}")


class CopyImagesStep(Step):
    """Copy multiple input images into the task working directory."""

    name = "copy_input"
    progress_start = 2
    progress_end = 5

    def run(self, ctx: JobContext) -> None:
        logger.info(f"[{ctx.job_id}] Starting input copy")

        ctx.create_dirs()

        raw_paths: List[str] = []

        for idx, path in enumerate(ctx.image_paths):
            if not path or not os.path.exists(path):
                raise FileNotFoundException(details={"path": path, "index": idx})

            ext = os.path.splitext(path)[1].lower() or ".png"
            dst = os.path.join(ctx.raw_dir, f"{idx + 1:03d}{ext}")

            try:
                shutil.copy2(path, dst)
            except Exception as exc:
                logger.debug(f"[{ctx.job_id}] copy2 failed for {path}, using stream copy: {exc}")
                with open(path, "rb") as rf, open(dst, "wb") as wf:
                    wf.write(rf.read())

            raw_paths.append(dst)

        ctx.raw_paths = raw_paths

        from app.shared.file_kinds import FileKind
        from app.pipeline.files_recorder import replace_files

        replace_files(
            ctx.job_id,
            FileKind.ORIGINAL_IMAGE,
            [os.path.abspath(path) for path in raw_paths],
        )

        logger.info(f"[{ctx.job_id}] Input copy completed: {len(raw_paths)} images")
