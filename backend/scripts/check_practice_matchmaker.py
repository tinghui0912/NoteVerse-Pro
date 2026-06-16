"""Diagnose Matchmaker practice engine initialization for a task or XML file."""

from __future__ import annotations

import argparse
import asyncio
import sys
import traceback
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from app.db.model_utils import require_persisted_id
from app.db.session import AsyncSessionLocal
from app.modules.practice.repository import PracticeRepository
from app.processing.engines.matchmaker_live import build_alignment_engine
from app.shared.file_kinds import FileKind
from app.storage.paths import materialize_storage_key


SOURCE_TO_KIND = {
    "current": FileKind.CURRENT_XML,
    "final": FileKind.FINAL_XML,
}


async def resolve_task_xml(task_uuid: str, source: str) -> str:
    repository = PracticeRepository()
    async with AsyncSessionLocal() as db:
        task = await repository.get_task_by_uuid(db, task_uuid)
        if task is None:
            raise RuntimeError(f"Task not found: {task_uuid}")
        task_id = require_persisted_id(task.id, entity="task")
        file_record = await repository.get_task_file_by_kind(
            db,
            task_id,
            SOURCE_TO_KIND[source],
        )
        if file_record is None or not file_record.storage_key:
            raise RuntimeError(f"{source} XML not found for task: {task_uuid}")
        return materialize_storage_key(file_record.storage_key)


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--task-id", help="Task UUID to diagnose.")
    parser.add_argument("--source", choices=sorted(SOURCE_TO_KIND), default="final")
    parser.add_argument("--xml-path", help="Direct MusicXML path to diagnose.")
    parser.add_argument("--sample-rate", type=int, default=16000)
    args = parser.parse_args()

    if not args.task_id and not args.xml_path:
        parser.error("Either --task-id or --xml-path is required.")

    try:
        score_file_path = (
            str(Path(args.xml_path).expanduser())
            if args.xml_path
            else await resolve_task_xml(args.task_id, args.source)
        )
        print(f"[INFO] score_file_path={score_file_path}")
        engine = build_alignment_engine(
            score_file_path=score_file_path,
            sample_rate=args.sample_rate,
            channels=1,
            frame_format="pcm_s16le",
        )
        engine.close()
        print("[OK] practice matchmaker engine initialized")
        return 0
    except Exception:
        print("[FAIL] practice matchmaker engine initialization failed", file=sys.stderr)
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
