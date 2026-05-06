"""Worker package for Celery task processing."""
from .celery_config import celery_app

__all__ = ['celery_app']
