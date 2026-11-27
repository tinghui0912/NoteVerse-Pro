import os
from types import ModuleType, SimpleNamespace
from unittest.mock import Mock

import pytest

from scripts import check_image_contract as contract


@pytest.fixture
def imports(monkeypatch):
    monkeypatch.setattr(contract.subprocess, "run", Mock())
    modules = {name: SimpleNamespace() for name in ("paddle", "paddleocr", "paddlex")}
    modules["verovio"] = SimpleNamespace(toolkit=object())
    modules["opentelemetry.exporter.otlp.proto.grpc.trace_exporter"] = SimpleNamespace(
        OTLPSpanExporter=object()
    )
    readiness = Mock(side_effect=AssertionError("Infrastructure/model readiness must not run"))
    modules["app.runtime.checks"] = SimpleNamespace(
        check_celery_tasks=Mock(
            return_value=SimpleNamespace(ok=True, message="task contract passed")
        ),
        run_runtime_checks=readiness,
        check_paddleocr_models=readiness,
        check_omr_cuda_runtime=readiness,
    )
    from app.runtime import diagnostics

    monkeypatch.setattr(diagnostics, "checks_for_role", lambda role: modules["app.runtime.checks"])
    monkeypatch.setattr(
        contract.importlib, "import_module", lambda name, package=None: modules[name]
    )
    return modules


def test_worker_uses_existing_task_contract_without_readiness(imports):
    evidence = contract.run_contract("worker")
    runtime = imports["app.runtime.checks"]
    runtime.check_celery_tasks.assert_called_once_with()
    runtime.run_runtime_checks.assert_not_called()
    assert "task contract passed" in evidence


def test_dependency_contract_does_not_import_application_or_models(imports):
    evidence = contract.run_contract("worker-deps")
    imports["app.runtime.checks"].check_celery_tasks.assert_not_called()
    assert "OTLP/Paddle/PaddleOCR/PaddleX imports passed; no models initialized" in evidence


def test_real_task_contract_missing_registrations_fails(monkeypatch):
    from app.runtime import diagnostics
    from app.runtime.checks import RuntimeChecks

    celery = SimpleNamespace(tasks={}, loader=SimpleNamespace(import_default_modules=lambda: None))
    checker = RuntimeChecks(Mock(), celery_app=celery)
    monkeypatch.setattr(diagnostics, "checks_for_role", lambda role: checker)
    monkeypatch.setattr(contract.subprocess, "run", Mock())
    with pytest.raises(RuntimeError, match="unregistered tasks"):
        contract.run_contract("worker")


@pytest.mark.parametrize("module", ["verovio", "paddle", "paddleocr", "paddlex"])
def test_worker_import_failure_is_fatal(imports, monkeypatch, module):
    def load(name):
        if name == module:
            raise ImportError("deliberately missing " + module)
        return imports[name]

    monkeypatch.setattr(contract.importlib, "import_module", load)
    with pytest.raises(ImportError, match="deliberately missing"):
        contract.run_contract("worker")


def test_uv_dependency_check_failure_is_fatal(monkeypatch):
    def fail(*args, **kwargs):
        raise contract.subprocess.CalledProcessError(1, args[0])

    monkeypatch.setattr(contract.subprocess, "run", fail)
    with pytest.raises(contract.subprocess.CalledProcessError):
        contract.run_contract("api")


def test_api_checks_all_shipped_composition_roots_without_starting_them(monkeypatch):
    calls = []
    monkeypatch.setattr(contract.subprocess, "run", Mock())
    monkeypatch.setattr(contract, "require_import", lambda *args: calls.append(args))
    migration = Mock()
    monkeypatch.setattr(contract, "check_migration_packaging", migration)
    contract.run_contract("api")
    assert calls == [
        (name, "app")
        for name in (
            "app.runtime.customer_api.main",
            "app.runtime.control_plane.main",
            "app.runtime.observability.main",
        )
    ]
    migration.assert_called_once_with()


def test_beat_checks_lock_composition_without_worker_execution(monkeypatch):
    calls = []
    monkeypatch.setattr(contract.subprocess, "run", Mock())
    monkeypatch.setattr(contract, "require_import", lambda *args: calls.append(args))
    monkeypatch.delitem(contract.sys.modules, "app.worker.tasks", raising=False)
    monkeypatch.setattr(contract.importlib.util, "find_spec", lambda _: None)
    contract.run_contract("beat")
    assert ("app.runtime.beat.leader", "BeatLeader") in calls
    assert not any(name == "app.worker.tasks" for name, _ in calls)


def test_beat_rejects_worker_task_import(monkeypatch):
    monkeypatch.setattr(contract.subprocess, "run", Mock())
    monkeypatch.setattr(contract, "require_import", lambda *args: None)
    monkeypatch.setitem(contract.sys.modules, "app.worker.tasks", ModuleType("app.worker.tasks"))
    with pytest.raises(RuntimeError, match="must not import"):
        contract.run_contract("beat")


def test_beat_rejects_worker_dependency_leak(monkeypatch):
    monkeypatch.setattr(contract.subprocess, "run", Mock())
    monkeypatch.setattr(contract, "require_import", lambda *args: None)
    monkeypatch.delitem(contract.sys.modules, "app.worker.tasks", raising=False)
    monkeypatch.setattr(contract.importlib.util, "find_spec", lambda _: object())
    with pytest.raises(RuntimeError, match="must not install Worker dependency"):
        contract.run_contract("beat")


@pytest.mark.parametrize("args", [[], ["--role", "all"], ["--role", "unknown"]])
def test_cli_requires_explicit_supported_role(args):
    with pytest.raises(SystemExit) as exc:
        contract.main(args)
    assert exc.value.code == 2


def test_programmatic_unknown_role_is_rejected():
    with pytest.raises(ValueError, match="Unknown image role"):
        contract.run_contract("all")


def test_cli_reports_failure_and_restores_ci_environment(monkeypatch, capsys):
    previous = os.environ.get("SECRET_KEY")

    def fail(_):
        assert os.environ["SECRET_KEY"] == "image-contract-only-not-a-production-secret"
        raise ImportError("missing runtime package")

    monkeypatch.setattr(contract, "run_contract", fail)
    assert contract.main(["--role", "worker"]) == 1
    assert "missing runtime package" in capsys.readouterr().err
    assert os.environ.get("SECRET_KEY") == previous


def test_dependency_check_uses_approved_uv_against_current_interpreter(imports):
    contract.run_contract("worker-deps")
    contract.subprocess.run.assert_called_once_with(
        ["uv", "pip", "check", "--python", contract.sys.executable],
        check=True,
    )
