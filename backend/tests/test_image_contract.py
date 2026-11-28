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
        contract.run_contract("core")


def test_core_runs_four_composition_roots_in_fresh_processes(monkeypatch):
    run = Mock()
    monkeypatch.setattr(contract.subprocess, "run", run)
    monkeypatch.setenv("OPERATOR_TOTP_ENCRYPTION_KEY", "private")
    monkeypatch.setenv("S3_SECRET_ACCESS_KEY", "private")
    contract.run_contract("core")
    children = run.call_args_list[1:]
    assert len(children) == 4
    assert [call.args[0][-1] for call in children] == list(contract.CORE_RUNTIMES)
    for call in children:
        assert "OPERATOR_TOTP_ENCRYPTION_KEY" not in call.kwargs["env"]
        assert "S3_SECRET_ACCESS_KEY" not in call.kwargs["env"]


@pytest.fixture
def core_imports(monkeypatch):
    monkeypatch.setattr(contract.importlib.util, "find_spec", lambda _: None)
    monkeypatch.setattr(contract.shutil, "which", lambda _: None)
    monkeypatch.setattr(contract, "require_import", Mock())
    monkeypatch.setattr(contract, "check_migration_packaging", Mock())
    for key in tuple(contract.sys.modules):
        if key.startswith(
            (
                "app.runtime.customer_api",
                "app.runtime.control_plane",
                "app.runtime.beat",
                "app.runtime.worker",
                "app.worker.tasks",
            )
        ):
            monkeypatch.delitem(contract.sys.modules, key)


@pytest.mark.parametrize("runtime", contract.CORE_RUNTIMES)
def test_core_runtime_import_without_infrastructure(core_imports, runtime):
    contract.check_core_runtime(runtime)
    if runtime == "migrator":
        contract.check_migration_packaging.assert_called_once_with()
    else:
        assert contract.require_import.called


def test_core_rejects_worker_task_import(core_imports, monkeypatch):
    monkeypatch.setitem(contract.sys.modules, "app.worker.tasks", ModuleType("app.worker.tasks"))
    with pytest.raises(RuntimeError, match="must not import"):
        contract.check_core_runtime("beat")


def test_core_rejects_worker_dependency(core_imports, monkeypatch):
    monkeypatch.setattr(contract.importlib.util, "find_spec", lambda _: object())
    with pytest.raises(RuntimeError, match="must not install Worker dependency"):
        contract.check_core_runtime("customer-api")


def test_core_rejects_cross_runtime_import(core_imports, monkeypatch):
    monkeypatch.setitem(
        contract.sys.modules,
        "app.runtime.customer_api.main",
        ModuleType("app.runtime.customer_api.main"),
    )
    with pytest.raises(RuntimeError, match="Cross-runtime import"):
        contract.check_core_runtime("control-plane")


@pytest.mark.parametrize("args", [[], ["--role", "all"], ["--role", "unknown"]])
def test_cli_requires_explicit_supported_role(args):
    with pytest.raises(SystemExit) as exc:
        contract.main(args)
    assert exc.value.code == 2


def test_programmatic_unknown_role_is_rejected():
    with pytest.raises(ValueError, match="Unknown image role"):
        contract.run_contract("all")


def test_cli_reports_failure_and_restores_ci_environment(monkeypatch, capsys):
    previous = os.environ.get("LOG_FORMAT")

    def fail(_):
        assert os.environ["LOG_FORMAT"] == "json"
        raise ImportError("missing runtime package")

    monkeypatch.setattr(contract, "run_contract", fail)
    assert contract.main(["--role", "worker"]) == 1
    assert "missing runtime package" in capsys.readouterr().err
    assert os.environ.get("LOG_FORMAT") == previous


def test_dependency_check_uses_approved_uv_against_current_interpreter(imports):
    contract.run_contract("worker-deps")
    contract.subprocess.run.assert_called_once_with(
        ["uv", "pip", "check", "--python", contract.sys.executable],
        check=True,
    )
