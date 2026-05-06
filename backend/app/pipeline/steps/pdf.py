"""PDF generation step for multi-image tasks."""

import os

from celery.utils.log import get_task_logger

from ..base import Step
from ..context import TaskContext

logger = get_task_logger(__name__)


class GeneratePdfStep(Step):
    """Merge multiple images into a PDF for Audiveris PDF mode."""

    name = "generate_pdf"
    progress_start = 5
    progress_end = 8

    def run(self, ctx: TaskContext) -> None:
        from PIL import Image

        logger.info(f"[{ctx.task_id}] Starting PDF generation")

        pdf_path = os.path.join(ctx.pdf_dir, "book.pdf")

        pdf_render_dpi = 300.0
        pdf_scale = pdf_render_dpi / 72.0
        max_pixels_target = 20_000_000
        effective_max_px = int(max_pixels_target / (pdf_scale * pdf_scale))
        max_long_edge = 1500

        logger.info(
            f"[{ctx.task_id}] PDF render settings: dpi={pdf_render_dpi}, "
            f"max_px={effective_max_px}, max_edge={max_long_edge}"
        )

        def _downscale_for_pdf(image: Image.Image) -> Image.Image:
            """Downscale large images before PDF rendering."""
            width, height = image.size
            total = width * height

            scale_px = 1.0
            if total > effective_max_px:
                scale_px = (effective_max_px / float(total)) ** 0.5

            long_edge = max(width, height)
            scale_edge = 1.0
            if long_edge > max_long_edge:
                scale_edge = max_long_edge / float(long_edge)

            scale = min(scale_px, scale_edge)
            if scale < 1.0:
                new_width = max(1, int(width * scale))
                new_height = max(1, int(height * scale))
                return image.resize((new_width, new_height), Image.LANCZOS)
            return image

        pages = []
        first = None

        for index, raw_path in enumerate(ctx.raw_paths):
            with Image.open(raw_path) as image:
                rendered = image.convert("RGB")
            rendered = _downscale_for_pdf(rendered)

            if index == 0:
                first = rendered
            else:
                pages.append(rendered)

        if first is None:
            raise ValueError("No valid images available for PDF generation")

        first.save(pdf_path, save_all=True, append_images=pages)
        ctx.pdf_path = pdf_path

        logger.info(f"[{ctx.task_id}] PDF generation completed: {pdf_path}")
