import copy

import pytest

from backend_worker_image_publication import check_workflow_documents


@pytest.fixture
def documents():
    scans = []
    steps = []
    for role in ("deps", "worker"):
        steps += [
            {"id": role + "-plan"},
            {"id": role + "-build", "if": "steps." + role + "-plan.outputs.action == 'build'",
             "with": {"tags": "${{ steps." + role + "-plan.outputs.candidate_ref }}",
                      "build-args": "PYTHON_IMAGE=${{ steps.base.outputs.digest_ref }}" if role == "deps" else "WORKER_DEPS_IMAGE=${{ steps.deps-select.outputs.digest_ref }}"}},
            {"id": role + "-select"}, {"id": role + "-contract"},
            {"id": role + "-sbom", "with": {"image": "${{ steps." + role + "-select.outputs.digest_ref }}"}},
            {"id": role + "-scan", "uses": "aquasecurity/trivy-action@pin", "with": {
                "image-ref": "${{ steps." + role + "-select.outputs.digest_ref }}", "vuln-type": "os,library", "severity": "CRITICAL", "ignore-unfixed": True, "exit-code": "1", "timeout": "20m",
            }, "env": {"TRIVY_IMAGE_SRC": "remote"}},
            {"id": role + "-promote", "env": {
                "GATE_CONTRACT": "${{ steps." + role + "-contract.outcome }}",
                "GATE_SBOM": "${{ steps." + role + "-sbom.outcome }}",
                "GATE_TRIVY": "${{ steps." + role + "-scan.outcome }}",
            }},
        ]
        scans.append(copy.deepcopy(steps[-2]))
    lifecycle = {"run": "python backend_worker_runner_disk.py before-scan\npython backend_worker_runner_disk.py after-scan"}
    steps.append(lifecycle)
    for scan in scans:
        scan["env"]["TRIVY_IMAGE_SRC"] = "docker"
    scans.append(lifecycle)
    trusted = {"on": {"workflow_dispatch": None},
               "concurrency": {"cancel-in-progress": False}, "jobs": {"build": {
                   "if": "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'",
                   "permissions": {"contents": "read", "packages": "write"}, "steps": steps}}}
    pr = {"on": {"pull_request": {}}, "permissions": {"contents": "read"},
          "jobs": {"validate": {"steps": scans}}}
    return trusted, pr


def test_valid_structural_boundaries(documents):
    check_workflow_documents(*documents)


def test_custom_dependency_tag_input_is_forbidden(documents):
    trusted, pr = documents
    trusted["on"]["workflow_dispatch"] = {"inputs": {"custom_base": {}}}
    with pytest.raises(ValueError, match="overrides"):
        check_workflow_documents(trusted, pr)


def test_pr_package_write_is_forbidden(documents):
    trusted, pr = documents
    pr["permissions"]["packages"] = "write"
    with pytest.raises(ValueError, match="read-only"):
        check_workflow_documents(trusted, pr)


def test_pr_push_command_is_forbidden(documents):
    trusted, pr = documents
    pr["jobs"]["validate"]["steps"].append({"run": "docker push something"})
    with pytest.raises(ValueError, match="cannot publish"):
        check_workflow_documents(trusted, pr)


def test_promoting_before_gates_is_forbidden(documents):
    trusted, pr = documents
    steps = trusted["jobs"]["build"]["steps"]
    promotion = next(s for s in steps if s.get("id") == "deps-promote")
    steps.remove(promotion)
    steps.insert(0, promotion)
    with pytest.raises(ValueError, match="before qualification"):
        check_workflow_documents(trusted, pr)


def test_promoting_despite_failed_gates_is_forbidden(documents):
    trusted, pr = documents
    promotion = next(s for s in trusted["jobs"]["build"]["steps"] if s.get("id") == "worker-promote")
    promotion["if"] = "always()"
    with pytest.raises(ValueError, match="bypass"):
        check_workflow_documents(trusted, pr)


def test_unconditional_canonical_build_tag_is_forbidden(documents):
    trusted, pr = documents
    build = next(s for s in trusted["jobs"]["build"]["steps"] if s.get("id") == "deps-build")
    build["with"]["tags"] = "${{ github.sha }}"
    with pytest.raises(ValueError, match="candidate"):
        check_workflow_documents(trusted, pr)


def test_ignoring_trivy_failure_is_forbidden(documents):
    trusted, pr = documents
    scan = next(s for s in trusted["jobs"]["build"]["steps"] if s.get("id") == "deps-scan")
    scan["continue-on-error"] = True
    with pytest.raises(ValueError, match="ignore failure"):
        check_workflow_documents(trusted, pr)


def test_default_short_scan_timeout_is_rejected(documents):
    trusted, pr = documents
    scan = next(s for s in pr["jobs"]["validate"]["steps"] if s.get("id") == "deps-scan")
    scan["with"].pop("timeout")
    with pytest.raises(ValueError, match="20m analysis budget"):
        check_workflow_documents(trusted, pr)
