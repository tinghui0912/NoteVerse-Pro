"""Physical writes and admission are owned by explicit current protocols."""

import ast
from pathlib import Path


def test_server_object_mutations_and_authority_have_explicit_owners():
    root = Path(__file__).resolve().parents[1] / "app"
    put_owners = set()
    create_owners = set()
    for path in (root / "modules").rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8-sig"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                if isinstance(node.func, ast.Attribute) and node.func.attr == "put_bytes":
                    put_owners.add(path.relative_to(root).as_posix())
                if isinstance(node.func, ast.Name) and node.func.id == "object_to_row":
                    create_owners.add(path.relative_to(root).as_posix())
    assert put_owners == {"modules/storage_objects/writes.py"}
    assert create_owners == {
        "modules/storage_objects/writes.py",
        "modules/storage_objects/persistence.py",
        "modules/performance_takes/upload_reservation/service.py",
    }
    # The pipeline composes the same write/adoption boundary rather than granting
    # another physical-storage mutation capability to its artifact recorder.
    pipeline = ast.parse(
        (root / "modules/import_jobs/pipeline/artifact_recorder.py").read_text(encoding="utf8")
    )
    assert all(
        not (
            isinstance(n, ast.Call)
            and isinstance(n.func, ast.Attribute)
            and n.func.attr == "put_bytes"
        )
        for n in ast.walk(pipeline)
    )
