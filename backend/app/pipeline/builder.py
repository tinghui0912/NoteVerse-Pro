"""Pipeline builder utilities."""

from typing import List, Optional

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
