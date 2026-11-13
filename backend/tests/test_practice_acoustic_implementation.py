"""Repository provenance verification is independent of product runtime projection."""

import copy
import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


def tool(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


verifier = tool("verify_practice_acoustic_implementation")
generator = tool("generate_practice_acoustic_runtime")
attestation = verifier.load_attestation(ROOT / verifier.ATTESTATION)
runtime = generator.load_json(ROOT / generator.CONTRACT_DIRECTORY / "runtime-contract.json")


@pytest.fixture
def repository(tmp_path):
    names = [
        verifier.ATTESTATION,
        "apps/customer-web/package.json",
        f"{generator.CONTRACT_DIRECTORY}/runtime-contract.json",
    ]
    names += [entry["path"] for entry in attestation["sourceFiles"].values()]
    names += [adapter["coefficientAsset"]["path"] for adapter in runtime["sourceAdapters"].values()]
    for name in names:
        target = tmp_path / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes((ROOT / name).read_bytes())
    return tmp_path


def test_reviewed_implementation_bytes_verify():
    verifier.verify()


def test_evidence_and_implementation_edits_do_not_change_runtime_projections(repository):
    generator.generate(repository)
    before = {name: (repository / name).read_bytes() for name in generator.projections(runtime)}
    declaration = repository / verifier.ATTESTATION
    changed = copy.deepcopy(attestation)
    changed["scope"] = "Repository review provenance."
    declaration.write_text(json.dumps(changed), encoding="utf-8")
    verifier.verify(repository)
    generator.generate(repository)
    assert before == {name: (repository / name).read_bytes() for name in before}
    source = repository / changed["sourceFiles"]["decoder"]["path"]
    source.write_bytes(source.read_bytes() + b"\n// implementation-only edit\n")
    with pytest.raises(ValueError, match="Source attestation mismatch"):
        verifier.verify(repository)
    generator.generate(repository, check=True)
    declaration.unlink()
    generator.generate(repository, check=True)
    assert before == {name: (repository / name).read_bytes() for name in before}
    assert generator.analysis_identity(runtime)["analysisIdentitySha256"] == generator.digest(
        runtime
    )


def test_production_projection_surfaces_contain_only_runtime_or_delivery_facts():
    outputs = generator.projections(runtime)
    for text in outputs.values():
        for entry in attestation["sourceFiles"].values():
            for field in ["path", "sha256", "scope"]:
                assert entry[field] not in text
        assert verifier.ATTESTATION not in text
        assert generator.digest(attestation) not in text
        assert "evidenceAttestationSha256" not in text
    python = outputs["backend/app/modules/model_assets/generated/practice_acoustic_model_asset.py"]
    import ast

    tree = ast.parse(python)
    assert {
        target.id
        for node in tree.body
        if isinstance(node, ast.Assign)
        for target in node.targets
        if isinstance(target, ast.Name)
    } == {
        "MODEL_ASSET",
        "MODEL_ASSET_DESCRIPTOR",
    }


@pytest.mark.parametrize(
    "field,value",
    [
        ("byteSize", 1),
        ("byteSize", True),
        ("sha256", "0" * 64),
        ("normalization", "trim"),
        ("path", "../outside.ts"),
        ("path", "/outside.ts"),
        ("path", "C:/outside.ts"),
        ("path", "apps\\outside.ts"),
    ],
)
def test_selected_sources_require_exact_safe_current_bytes(field, value):
    changed = copy.deepcopy(attestation)
    changed["sourceFiles"]["decoder"][field] = value
    with pytest.raises(ValueError):
        verifier.validate(changed)


@pytest.mark.parametrize("location", [(), ("sourceFiles",), ("sourceFiles", "decoder")])
def test_unclassified_attestation_fields_fail_closed(location):
    changed = copy.deepcopy(attestation)
    target = changed
    for field in location:
        target = target[field]
    target["unclassified"] = True
    with pytest.raises(ValueError):
        verifier.validate(changed)


def test_duplicate_paths_and_missing_roles_fail_closed():
    changed = copy.deepcopy(attestation)
    changed["sourceFiles"]["decoder"] = changed["sourceFiles"]["sourceAdapter"]
    with pytest.raises(ValueError, match="Duplicate"):
        verifier.validate(changed)
    del changed["sourceFiles"]["decoder"]
    with pytest.raises(ValueError):
        verifier.validate(changed)


@pytest.mark.parametrize(
    "text",
    [
        '{"schemaVersion":1,"schemaVersion":1}',
        '{"sourceFiles":{"decoder":{},"decoder":{}}}',
        '{"schemaVersion":NaN}',
        '{"schemaVersion":Infinity}',
    ],
)
def test_duplicate_json_keys_and_non_json_constants_fail_closed(tmp_path, text):
    source = tmp_path / "attestation.json"
    source.write_text(text, encoding="utf-8")
    with pytest.raises(ValueError):
        verifier.load_attestation(source)


def test_source_normalization_preserves_all_bytes_except_crlf(repository):
    raw = "\ufeffsource  \r\nend\r".encode()
    assert verifier.normalized_source_bytes(raw) == "\ufeffsource  \nend\r".encode()
    entry = attestation["sourceFiles"]["decoder"]
    path = repository / entry["path"]
    path.write_bytes(verifier.normalized_source_bytes(path.read_bytes()).replace(b"\n", b"\r\n"))
    verifier.verify(repository)


def test_symlink_cannot_escape_repository(repository, tmp_path):
    outside = tmp_path.parent / f"{tmp_path.name}-outside.ts"
    outside.write_bytes(b"outside")
    link = repository / "escape.ts"
    link.symlink_to(outside)
    with pytest.raises(ValueError):
        verifier.source_file(repository, "escape.ts")


@pytest.mark.parametrize("version", [True, 2])
def test_implementation_schema_version_is_exact(version):
    changed = copy.deepcopy(attestation)
    changed["schemaVersion"] = version
    with pytest.raises(ValueError):
        verifier.validate(changed)
