"""Real image fixtures for content-verified upload admission."""

import io
from PIL import Image


def image_bytes(container="PNG"):
    output = io.BytesIO()
    Image.new("RGB", (2, 2), "red").save(output, format=container)
    return output.getvalue()
