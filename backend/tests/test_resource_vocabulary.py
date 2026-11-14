"""Canonical resource vocabulary across Upload, Import admission and PerformanceTake."""

import ast
import inspect
from pathlib import Path

import pytest
from fastapi import UploadFile
from pydantic import ValidationError

from app.main import app
from app.db.models.upload import Upload
from app.modules.uploads.schemas import UploadRead
from app.modules.uploads.service import UploadService
from app.modules.uploads.repository import UploadRepository
from app.modules.uploads.dependencies import get_upload_service
from app.modules.import_jobs.schemas import ImportJobSubmitRequest
from app.modules.performance_takes.aggregate import (
    PerformanceTakeFacts,
    performance_take_facts_from_row,
)

ROOT = Path(__file__).resolve().parents[1] / "app"


def test_upload_resource_has_canonical_module_and_model_owners():
    assert Upload.__module__ == "app.db.models.upload" and Upload.__tablename__ == "uploads"
    assert UploadService.__module__ == "app.modules.uploads.service"
    assert UploadRepository.__module__ == "app.modules.uploads.repository"
    assert get_upload_service.__module__ == "app.modules.uploads.dependencies"
    assert (
        inspect.signature(UploadService.create_upload).parameters["file"].annotation is UploadFile
    )
    assert not (ROOT / "modules/files").exists()
    assert not (ROOT / "db/models/file.py").exists()
    forbidden = {
        "FilesService",
        "FilesRepository",
        "get_files_service",
        "files_service",
        "SavedTakeFacts",
    }
    for path in ROOT.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                assert not (node.module or "").startswith("app.modules.files"), path
            if isinstance(node, (ast.Name, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
                assert getattr(node, "id", getattr(node, "name", None)) not in forbidden, path


def test_upload_and_import_contract_express_resource_identity_without_aliases():
    schema = app.openapi()
    paths = schema["paths"]
    assert paths["/api/v1/uploads"]["post"]["operationId"] == "uploadsCreate"
    deletion = paths["/api/v1/uploads/{upload_id}"]["delete"]
    assert deletion["operationId"] == "uploadDelete"
    assert deletion["responses"]["204"].get("content") is None
    assert not any(path.startswith("/api/v1/files") for path in paths)
    operations = [
        operation["operationId"]
        for methods in paths.values()
        for operation in methods.values()
        if isinstance(operation, dict) and "operationId" in operation
    ]
    assert len(operations) == len(set(operations))
    assert not {"filesUpload", "fileDelete"} & set(operations)
    assert set(UploadRead.model_fields) == {"upload_id", "original_filename", "byte_size"}
    assert set(schema["components"]["schemas"]["UploadRead"]["properties"]) == set(
        UploadRead.model_fields
    )
    assert (
        schema["components"]["schemas"]["ImportJobSubmitRequest"]["properties"].keys()
        == ImportJobSubmitRequest.model_fields.keys()
    )
    assert ImportJobSubmitRequest(upload_ids=["upload"]).upload_ids == ["upload"]
    assert "file_ids" not in ImportJobSubmitRequest.model_fields
    with pytest.raises(ValidationError):
        ImportJobSubmitRequest.model_validate({"file_ids": ["upload"]})
    with pytest.raises(ValidationError):
        ImportJobSubmitRequest.model_validate({"upload_ids": ["upload"], "file_ids": ["upload"]})


def test_performance_take_facts_have_one_canonical_type():
    assert PerformanceTakeFacts.__module__ == "app.modules.performance_takes.aggregate"
    assert (
        inspect.signature(performance_take_facts_from_row).return_annotation is PerformanceTakeFacts
    )
