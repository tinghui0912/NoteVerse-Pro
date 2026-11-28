"""All XML parser capabilities are owned by the bounded document admission boundary."""

import ast
from pathlib import Path

APP = Path(__file__).resolve().parents[2] / "app"
VETTED = APP / "platform/document_admission/musicxml.py"
TREE_BUILDING = {
    "Element",
    "SubElement",
    "ElementTree",
    "tostring",
    "indent",
    "register_namespace",
    "ParseError",
}
XML_MODULES = ("xml", "lxml", "defusedxml")


def test_platform_admission_imports_only_platform_and_standard_libraries():
    for path in (APP / "platform/document_admission").rglob("*.py"):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            names = (
                [a.name for a in node.names]
                if isinstance(node, ast.Import)
                else [node.module or ""]
                if isinstance(node, ast.ImportFrom)
                else []
            )
            assert all(not n.startswith(("app.modules", "app.runtime")) for n in names), path


def test_xml_parser_capabilities_are_confined_to_admission():
    for path in APP.rglob("*.py"):
        if path == VETTED:
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        aliases = set()
        constructors = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for name in node.names:
                    if name.name.startswith(XML_MODULES):
                        assert name.name == "xml.etree.ElementTree" and name.asname, path
                        aliases.add(name.asname)
            elif (
                isinstance(node, ast.ImportFrom)
                and not node.level
                and (node.module or "").startswith(XML_MODULES)
            ):
                assert node.module == "xml.etree.ElementTree", path
                assert all(a.name in TREE_BUILDING for a in node.names), path
                constructors.update(
                    a.asname or a.name for a in node.names if a.name == "ElementTree"
                )
            elif (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id in {"__import__", "import_module"}
            ):
                if (
                    node.args
                    and isinstance(node.args[0], ast.Constant)
                    and isinstance(node.args[0].value, str)
                ):
                    assert not node.args[0].value.startswith(XML_MODULES), path
        for node in ast.walk(tree):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id in constructors
            ):
                assert not node.keywords and len(node.args) <= 1, (path, node.lineno)
            if (
                isinstance(node, ast.Attribute)
                and isinstance(node.value, ast.Name)
                and node.value.id in aliases
            ):
                assert node.attr in TREE_BUILDING, (path, node.lineno, node.attr)
                if node.attr == "ElementTree" and isinstance(getattr(node, "ctx", None), ast.Load):
                    # An ElementTree may wrap a constructed element, never parse a file argument.
                    for parent in ast.walk(tree):
                        if isinstance(parent, ast.Call) and parent.func is node:
                            assert not parent.keywords and len(parent.args) <= 1, (
                                path,
                                parent.lineno,
                            )
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr == "loadFile"
            ):
                raise AssertionError(
                    f"Native renderers consume admitted bytes: {path}:{node.lineno}"
                )
