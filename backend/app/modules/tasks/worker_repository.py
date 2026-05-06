"""Worker-side synchronous repository helpers for task persistence."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.db.models import File, Task, TaskStep, TaskUpload, Upload


class SyncTaskRepository:
    """Encapsulate synchronous ORM access for worker-side task flows."""

    @staticmethod
    def get_task_by_uuid(db: Session, task_uuid: str) -> Task | None:
        return db.query(Task).filter_by(task_uuid=task_uuid).first()

    @staticmethod
    def get_step(db: Session, task_id: int, name: str) -> TaskStep | None:
        return db.query(TaskStep).filter_by(task_id=task_id, name=name).first()

    @staticmethod
    def list_steps_for_task(db: Session, task_id: int) -> list[TaskStep]:
        return db.query(TaskStep).filter_by(task_id=task_id).order_by(TaskStep.step_order).all()

    @staticmethod
    def list_files_for_task(db: Session, task_id: int) -> list[File]:
        return db.query(File).filter_by(task_id=task_id).all()

    @staticmethod
    def delete_files_by_kind(db: Session, task_id: int, kind: str) -> None:
        db.query(File).filter_by(task_id=task_id, kind=kind).delete()

    @staticmethod
    def get_upload_by_sha256(db: Session, upload_sha256: str) -> Upload | None:
        return db.query(Upload).filter_by(sha256=upload_sha256).first()

    @staticmethod
    def get_task_upload_link(db: Session, task_id: int, upload_id: int) -> TaskUpload | None:
        return db.query(TaskUpload).filter_by(task_id=task_id, upload_id=upload_id).first()

    @staticmethod
    def list_task_upload_rows(
        db: Session,
        task_id: int,
    ) -> list[tuple[TaskUpload, Upload]]:
        return (
            db.query(TaskUpload, Upload)
            .join(Upload, TaskUpload.upload_id == Upload.id)
            .filter(TaskUpload.task_id == task_id)
            .all()
        )


sync_task_repository = SyncTaskRepository()
