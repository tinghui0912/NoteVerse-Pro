"""Ownership of the trusted document boundary and its application consumers."""

import ast
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1] / "app"


def test_admission_depends_only_on_semantic_owners_and_public_error_mapping():
    tree = ast.parse((ROOT / "processing/musicxml/admission.py").read_text())
    owned_dependencies = {
        "app.score_semantics.musicxml_score",
        "app.score_semantics.musicxml_tempo",
        "app.core.exceptions",
        "app.shared.constants",
    }
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            assert not node.level
            assert (
                node.module in owned_dependencies
                or node.module.split(".")[0] in sys.stdlib_module_names
            )
        elif isinstance(node, ast.Import):
            assert all(a.name.split(".")[0] in sys.stdlib_module_names for a in node.names)


def test_trusted_document_entry_points_share_the_admission_owner():
    consumers = [
        ("modules/revisions/service.py", "RevisionService", "create", 1),
        ("modules/revisions/service.py", "RevisionService", "restore", 1),
        ("modules/review/service.py", "ReviewService", "confirm", 1),
        ("modules/review/service.py", "ReviewService", "update", 1),
        ("modules/fingering/service.py", "FingeringService", "generate", 2),
    ]
    for path, class_name, method_name, calls in consumers:
        tree = ast.parse((ROOT / path).read_text())
        assert any(
            isinstance(n, ast.ImportFrom)
            and n.module == "app.processing.musicxml.admission"
            and any(a.name == "admit_musicxml_document" for a in n.names)
            for n in ast.walk(tree)
        )
        owner = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == class_name)
        method = next(
            n
            for n in owner.body
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == method_name
        )
        assert (
            sum(
                isinstance(n, ast.Call)
                and isinstance(n.func, ast.Name)
                and n.func.id == "admit_musicxml_document"
                for n in ast.walk(method)
            )
            == calls
        )
