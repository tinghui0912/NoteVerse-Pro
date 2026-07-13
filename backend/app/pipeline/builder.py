"""Pipeline builder utilities."""

from typing import List, Optional

from app.modules.import_jobs.schemas import ImportJobProcessingOptions
from .base import Pipeline


class PipelineBuilder:
    """Build the correct pipeline variant for the given input set."""

    @staticmethod
    def build(
        image_paths: List[str],
        options: Optional[ImportJobProcessingOptions] = None,
    ) -> Pipeline:
        """Build a single-image or multi-image pipeline."""
        if len(image_paths) == 1:
            return PipelineBuilder.build_single_image(options)
        return PipelineBuilder.build_multi_image(options)

    @staticmethod
    def build_single_image(
        options: Optional[ImportJobProcessingOptions] = None,
    ) -> Pipeline:
        """Build the single-image processing pipeline."""
        from .steps import (
            CopyImageStep,
            ExtractXmlStep,
            OmrStep,
            TextOcrStep,
            XmlNormalizeStep,
        )

        return Pipeline(
            [
                CopyImageStep(),
                OmrStep(),
                ExtractXmlStep(),
                TextOcrStep(),
                XmlNormalizeStep(),
            ]
        )

    @staticmethod
    def build_multi_image(
        options: Optional[ImportJobProcessingOptions] = None,
    ) -> Pipeline:
        """Build the multi-image processing pipeline."""
        from .steps import (
            CopyImagesStep,
            ExtractXmlStep,
            OmrStep,
            TextOcrStep,
            XmlNormalizeStep,
        )

        return Pipeline(
            [
                CopyImagesStep(),
                OmrStep(),
                ExtractXmlStep(),
                TextOcrStep(),
                XmlNormalizeStep(),
            ]
        )
