"""
Celery worker startup script.

Usage:
    python worker.py
    
Or with Celery CLI:
    celery -A worker.celery_app worker --loglevel=info
"""
import sys
import os
import logging

# Add backend_new to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# 配置日志格式
logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] [%(levelname)8s] %(name)s:%(lineno)d - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)

from app.worker.celery_config import celery_app

# Import tasks to register them with Celery
from app.worker import tasks  # noqa: F401

if __name__ == '__main__':
    # Start worker programmatically
    worker = celery_app.Worker(
        loglevel='info',
        pool='solo',  # Windows compatibility
    )
    worker.start()
