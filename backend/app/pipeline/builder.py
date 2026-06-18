"""Pipeline builder utilities."""

from typing import List, Optional

from app.core.config import settings
from app.modules.tasks.schemas import TaskProcessingOptions
from .base import Pipeline


class PipelineBuilder:
    """Build the correct pipeline variant for the given input set."""

    @staticmethod
    def build(
        image_paths: List[str],
        options: Optional[TaskProcessingOptions] = None,
    ) -> Pipeline:
        """Build a single-image or multi-image pipeline."""
        if len(image_paths) == 1:
            return PipelineBuilder.build_single_image(options)
        return PipelineBuilder.build_multi_image(options)

    @staticmethod
    def build_single_image(
        options: Optional[TaskProcessingOptions] = None,
    ) -> Pipeline:
        """Build the single-image processing pipeline."""
        from .steps import (
            CopyImageStep,
            ExtractXmlStep,
            FinalizeStep,
            OmrImageStep,
            PreviewGenerationStep,
            TextOcrStep,
            XmlNormalizeStep,
        )

        return Pipeline(
            [
                CopyImageStep(),
                OmrImageStep(),
                ExtractXmlStep(),
                TextOcrStep(),
                XmlNormalizeStep(),
                PreviewGenerationStep(),
                FinalizeStep(),
            ]
        )

    @staticmethod
    def build_multi_image(
        options: Optional[TaskProcessingOptions] = None,
    ) -> Pipeline:
        """Build the multi-image processing pipeline."""
        if settings.OMR_ENGINE == "legato":
            return PipelineBuilder.build_multi_image_pages(options)

        return PipelineBuilder.build_multi_image_pdf(options)

    @staticmethod
    def build_multi_image_pages(
        options: Optional[TaskProcessingOptions] = None,
    ) -> Pipeline:
        """Build the multi-image pipeline for engines that consume ordered pages."""
        from .steps import (
            CopyImagesStep,
            ExtractXmlStep,
            FinalizeStep,
            OmrImagesStep,
            PreviewGenerationStep,
            TextOcrStep,
            XmlNormalizeStep,
        )

        return Pipeline(
            [
                CopyImagesStep(),
                OmrImagesStep(),
                ExtractXmlStep(),
                TextOcrStep(),
                XmlNormalizeStep(),
                PreviewGenerationStep(),
                FinalizeStep(),
            ]
        )

    @staticmethod
    def build_multi_image_pdf(
        options: Optional[TaskProcessingOptions] = None,
    ) -> Pipeline:
        """Build the multi-image pipeline for engines that consume generated PDFs."""
        from .steps import (
            CopyImagesStep,
            ExtractXmlStep,
            FinalizeStep,
            GeneratePdfStep,
            OmrPdfStep,
            PreviewGenerationStep,
            TextOcrStep,
            XmlNormalizeStep,
        )

        return Pipeline(
            [
                CopyImagesStep(),
                GeneratePdfStep(),
                OmrPdfStep(),
                ExtractXmlStep(),
                TextOcrStep(),
                XmlNormalizeStep(),
                PreviewGenerationStep(),
                FinalizeStep(),
            ]
        )
