"""Pipeline builder utilities."""

from typing import List

from .base import Pipeline


class PipelineBuilder:
    """Build the correct pipeline variant for the given input set."""

    @staticmethod
    def build(
        image_paths: List[str],
    ) -> Pipeline:
        """Build a single-image or multi-image pipeline."""
        if len(image_paths) == 1:
            return PipelineBuilder.build_single_image()
        return PipelineBuilder.build_multi_image()

    @staticmethod
    def build_single_image() -> Pipeline:
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
    def build_multi_image() -> Pipeline:
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
