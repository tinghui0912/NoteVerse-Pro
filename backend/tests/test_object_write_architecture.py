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
        "modules/performance_takes/writer.py",
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


def test_all_application_and_script_mutation_paths_have_a_physical_owner():
    root = Path(__file__).resolve().parents[1]
    # Adapter methods implement the storage port; they do not admit product objects.
    storage_delete_owners = {
        "app/worker/execution/stored_object_retirement.py",  # formal adopted objects
        "app/worker/execution/object_write_cleanup.py",  # unadopted intent generations
        "app/modules/performance_takes/upload_reservation/cleanup.py",  # business-owned staging/candidates
    }
    row_fact_owners = {"app/modules/storage_objects/persistence.py"}
    row_admission_owners = row_fact_owners | {
        "app/modules/storage_objects/writes.py",
        "app/modules/performance_takes/writer.py",  # fully verified, unique lease candidate
    }
    for directory in (root / "app", root / "scripts"):
        for path in directory.rglob("*.py"):
            relative = path.relative_to(root).as_posix()
            if relative.startswith("app/storage/"):
                continue
            tree = ast.parse(path.read_text(encoding="utf-8-sig"))
            aliases = {
                alias.asname or alias.name: alias.name
                for node in ast.walk(tree)
                if isinstance(node, ast.ImportFrom)
                for alias in node.names
            }
            for node in ast.walk(tree):
                if not isinstance(node, ast.Call):
                    continue
                name = (
                    aliases.get(node.func.id, node.func.id)
                    if isinstance(node.func, ast.Name)
                    else node.func.attr
                    if isinstance(node.func, ast.Attribute)
                    else None
                )
                if name in {"put_object", "copy_object", "delete_object"}:
                    # Deployment model distribution is manifest-owned, not a customer StoredObject.
                    assert (
                        name == "put_object"
                        and relative == "scripts/verify_practice_acoustic_model_asset.py"
                    ), (relative, node.lineno)
                if name == "StoredObject":
                    assert relative in row_fact_owners, (relative, node.lineno)
                if name == "object_to_row":
                    assert relative in row_admission_owners, (relative, node.lineno)
                if name == "object_from_bytes":
                    assert relative in row_fact_owners, (relative, node.lineno)
                if name == "put_bytes":
                    assert relative == "app/modules/storage_objects/writes.py", (
                        relative,
                        node.lineno,
                    )
                if name == "copy":
                    receiver = (
                        ast.unparse(node.func.value) if isinstance(node.func, ast.Attribute) else ""
                    )
                    if "storage" in receiver:
                        assert relative == "app/modules/performance_takes/final_media.py", (
                            relative,
                            node.lineno,
                        )
                if name == "delete" and isinstance(node.func, ast.Attribute):
                    receiver = ast.unparse(node.func.value)
                    receiver = aliases.get(receiver, receiver)
                    if "storage" in receiver:
                        assert relative in storage_delete_owners, (relative, node.lineno)
                if name in {"insert", "update", "delete"} and node.args:
                    if ast.unparse(node.args[0]) in {
                        "StoredObject",
                        "StoredObject.__table__",
                    }:
                        raise AssertionError(
                            (
                                relative,
                                node.lineno,
                                "StoredObject SQL mutation bypasses lifecycle admission",
                            )
                        )
