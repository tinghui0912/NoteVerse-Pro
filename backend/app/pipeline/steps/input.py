"""Input-copy steps for single-image and multi-image tasks."""

import os
import shutil
from typing import List

from app.core.exceptions import FileNotFoundException
from app.core.logger import logger

from ..base import Step
from ..context import JobContext


class CopyImageStep(Step):
    """Copy a single input image into the task working directory."""

    name = "copy_input"
    progress_start = 2
    progress_end = 5

    def run(self, ctx: JobContext) -> None:
        logger.bind(
            event="import_pipeline.input_copy_started",
            job_id=ctx.job_id,
            page_count=1,
        ).info("Input copy started")

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
            logger.bind(
                event="import_pipeline.input_copy_fallback_used",
                job_id=ctx.job_id,
                source_path=abs_path,
                destination_path=dst,
                exception_type=type(exc).__name__,
            ).opt(exception=exc).debug("Input copy fallback used")
            with open(abs_path, "rb") as rf, open(dst, "wb") as wf:
                wf.write(rf.read())

        ctx.raw_paths = [dst]

        logger.bind(
            event="import_pipeline.input_copy_completed",
            job_id=ctx.job_id,
            page_count=1,
            destination_path=dst,
        ).info("Input copy completed")


class CopyImagesStep(Step):
    """Copy multiple input images into the task working directory."""

    name = "copy_input"
    progress_start = 2
    progress_end = 5

    def run(self, ctx: JobContext) -> None:
        logger.bind(
            event="import_pipeline.input_copy_started",
            job_id=ctx.job_id,
            page_count=len(ctx.image_paths),
        ).info("Input copy started")

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
                logger.bind(
                    event="import_pipeline.input_copy_fallback_used",
                    job_id=ctx.job_id,
                    source_path=path,
                    destination_path=dst,
                    page_index=idx,
                    exception_type=type(exc).__name__,
                ).opt(exception=exc).debug("Input copy fallback used")
                with open(path, "rb") as rf, open(dst, "wb") as wf:
                    wf.write(rf.read())

            raw_paths.append(dst)

        ctx.raw_paths = raw_paths

        logger.bind(
            event="import_pipeline.input_copy_completed",
            job_id=ctx.job_id,
            page_count=len(raw_paths),
        ).info("Input copy completed")
