"""Worker-only registry policy and workflow governance; not dependency identity."""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import re
import subprocess
import sys

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))
from scripts.oci_publication import (  # noqa: E402
    DockerRegistry, Plan, Registry, candidate_tag, outputs, promote_qualified, validate_digest,
)
from scripts.worker_image_identity import SCHEMA, project_configuration  # noqa: E402

REPOSITORY = re.compile(r"ghcr\.io/[a-z0-9_.-]+/noteverse/(?:backend-worker-deps|backend-worker)")


def canonical_tag(role: str, identity: str) -> str:
    if role == "deps" and re.fullmatch(r"[a-f0-9]{64}", identity):
        return f"deps-v{SCHEMA}-{identity}"
    if role == "worker" and re.fullmatch(r"[a-f0-9]{40}", identity):
        return identity
    raise ValueError("Canonical identity must be a full v3 build key or source SHA, never a custom tag")

def validate_repository(repository: str) -> str:
    if not REPOSITORY.fullmatch(repository):
        raise ValueError("Expected a bounded NoteVerse Worker GHCR repository")
    return repository


def validate_artifact_repository(repository: str, role: str) -> None:
    validate_repository(repository)
    suffix = "/backend-worker-deps" if role == "deps" else "/backend-worker"
    if role not in ("deps", "worker") or not repository.endswith(suffix):
        raise ValueError("Artifact role/repository mismatch")

def plan(registry: Registry, repository: str, role: str, identity: str, run: str, attempt: str) -> Plan:
    validate_artifact_repository(repository, role)
    canonical = repository + ":" + canonical_tag(role, identity)
    candidate = repository + ":" + candidate_tag(run, attempt)
    existing = registry.resolve(canonical)
    if existing is not None:
        validate_digest(existing)
        if role == "worker":
            # A source SHA alone does not bind this run's selected dependency OCI.
            raise RuntimeError("Worker source tag already exists; refuse recomposition or retagging without a proven dependency edge")
        return Plan("reuse", canonical, candidate, existing, repository + "@" + existing)
    if registry.resolve(candidate) is not None:
        raise RuntimeError("Run-attempt candidate already exists; refuse to overwrite it")
    return Plan("build", canonical, candidate, "", "")


def promote(registry: Registry, repository: str, role: str, identity: str, digest: str,
            qualification: dict[str, str]) -> str:
    validate_artifact_repository(repository, role)
    return promote_qualified(registry, repository, canonical_tag(role, identity), digest, qualification)


def check_workflow_documents(trusted: dict, pr: dict) -> None:
    """Check the actual parsed Worker YAML, alongside state-machine unit tests."""
    trusted_on = trusted.get("on", trusted.get(True))
    pr_on = pr.get("on", pr.get(True))
    if not isinstance(trusted_on, dict) or not isinstance(pr_on, dict):
        raise ValueError("Explicit Worker workflow events are required")
    if set(trusted_on) != {"workflow_dispatch"} or set(pr_on) != {"pull_request"}:
        raise ValueError("Worker PR and trusted publication event boundaries changed")
    if trusted_on["workflow_dispatch"] not in (None, {}):
        raise ValueError("Custom dependency tag overrides are forbidden")
    if trusted["concurrency"]["cancel-in-progress"] is not False:
        raise ValueError("Trusted first-build-wins publication must be serialized, never cancelled")
    read = {"contents": "read"}
    if pr["permissions"] != read:
        raise ValueError("PR token must be read-only")
    for job in pr["jobs"].values():
        if job.get("permissions", read) != read:
            raise ValueError("PR job cannot elevate permissions")
        for step in job["steps"]:
            run = step.get("run", "")
            if re.search(r"docker\s+push\b|--push\b|imagetools\s+create\b|worker_image_publication\.py[^\n]*\bpromote\b", run):
                raise ValueError("PR workflow cannot publish or promote")
            if "build-push-action" in step.get("uses", "") and step.get("with", {}).get("push") not in (False, "false"):
                raise ValueError("PR action cannot push")
    job = trusted["jobs"]["build"]
    if job["permissions"] != {"contents": "read", "packages": "write"}:
        raise ValueError("Only the trusted job may write packages")
    if "workflow_dispatch" not in job["if"] or "refs/heads/main" not in job["if"]:
        raise ValueError("Trusted publication must be main-only manual execution")
    steps = {s["id"]: s for s in job["steps"] if "id" in s}
    order = [s.get("id") for s in job["steps"]]
    for role in ("deps", "worker"):
        build = steps[role + "-build"]
        if build["with"]["tags"] != "${{ steps." + role + "-plan.outputs.candidate_ref }}":
            raise ValueError("Buildx may push only an attempt-specific candidate, never a canonical tag")
        if build["if"] != "steps." + role + "-plan.outputs.action == 'build'":
            raise ValueError("Existing canonical identity must skip rebuilding")
        promotion = steps[role + "-promote"]
        if promotion.get("if", "success()") != "success()" or promotion.get("continue-on-error", False):
            raise ValueError("Canonical promotion cannot bypass failed gates")
        for gate, suffix in (("CONTRACT", "contract"), ("SBOM", "sbom"), ("TRIVY", "scan")):
            gate_id = role + "-" + suffix
            if order.index(gate_id) >= order.index(role + "-promote"):
                raise ValueError("Canonical promotion appears before qualification")
            if steps[gate_id].get("continue-on-error", False):
                raise ValueError("Worker qualification cannot ignore failure")
            if promotion["env"].get("GATE_" + gate) != "${{ steps." + gate_id + ".outcome }}":
                raise ValueError("Promotion must consume actual gate outcomes")
        expected = "${{ steps." + role + "-select.outputs.digest_ref }}"
        if steps[role + "-sbom"]["with"]["image"] != expected or steps[role + "-scan"]["with"]["image-ref"] != expected:
            raise ValueError("Trusted SBOM/Trivy must bind to the selected immutable OCI")
    if "PYTHON_IMAGE=${{ steps.base.outputs.digest_ref }}" not in steps["deps-build"]["with"]["build-args"]:
        raise ValueError("Dependency image must build FROM immutable Python base")
    if "WORKER_DEPS_IMAGE=${{ steps.deps-select.outputs.digest_ref }}" not in steps["worker-build"]["with"]["build-args"]:
        raise ValueError("Final Worker must build FROM immutable dependency image")
    for document, source in ((trusted, "remote"), (pr, "docker")):
        scans = [s for j in document["jobs"].values() for s in j["steps"] if "trivy-action" in s.get("uses", "")]
        if len(scans) != 2:
            raise ValueError("Both Worker artifact scans are required")
        for scan in scans:
            config = scan["with"]
            if (config["vuln-type"], config["severity"], config["ignore-unfixed"], str(config["exit-code"])) != ("os,library", "CRITICAL", True, "1"):
                raise ValueError("Worker Trivy policy changed")
            if config.get("timeout") != "20m":
                raise ValueError("Heavy Worker scans require the explicit bounded 20m analysis budget")
            if scan["env"]["TRIVY_IMAGE_SRC"] != source:
                raise ValueError("Unexpected Worker scan source")
        commands = "\n".join(s.get("run", "") for j in document["jobs"].values() for s in j["steps"])
        if "worker_image_disk.py before-scan" not in commands or "worker_image_disk.py after-scan" not in commands:
            raise ValueError("Worker scan disk lifecycle is required")


def check_workflows(repo: Path) -> None:
    import yaml

    def load(name: str) -> dict:
        return yaml.safe_load((repo / ".github/workflows" / name).read_text(encoding="utf-8"))
    check_workflow_documents(load("backend-worker-image.yml"), load("backend-worker-pr-image.yml"))
    print("Worker YAML trust/promotion/security/disk contracts passed")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, help="GitHub step output file")
    sub = parser.add_subparsers(dest="command", required=True)
    base = sub.add_parser("resolve-base")
    base.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[2])
    workflows = sub.add_parser("check-workflows")
    workflows.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[2])
    select = sub.add_parser("select")
    select.add_argument("--repository", required=True)
    select.add_argument("--role", choices=("deps", "worker"), required=True)
    select.add_argument("--existing-digest", default="")
    select.add_argument("--built-digest", default="")
    for name in ("plan", "promote"):
        command = sub.add_parser(name)
        command.add_argument("--repository", required=True)
        command.add_argument("--role", choices=("deps", "worker"), required=True)
        command.add_argument("--identity", required=True)
        if name == "plan":
            command.add_argument("--run-id", required=True)
            command.add_argument("--run-attempt", required=True)
        else:
            command.add_argument("--digest", required=True)
    args = parser.parse_args(argv)
    try:
        registry = DockerRegistry()
        if args.command == "check-workflows":
            check_workflows(args.repo)
        elif args.command == "select":
            validate_artifact_repository(args.repository, args.role)
            if bool(args.existing_digest) == bool(args.built_digest):
                raise ValueError("Exactly one reused or newly built OCI is required")
            digest = validate_digest(args.existing_digest or args.built_digest)
            outputs({"oci_digest": digest, "digest_ref": args.repository + "@" + digest}, args.output)
        elif args.command == "resolve-base":
            tag_ref = project_configuration(args.repo)["tool"]["noteverse"]["images"]["worker-python"]
            if tag_ref != "python:3.12-slim-bookworm":
                raise ValueError("Unsupported governed Worker Python base")
            base_digest = registry.resolve(tag_ref)
            if base_digest is None:
                raise RuntimeError("Governed Python base is missing; fail closed")
            outputs({"tag_ref": tag_ref, "oci_digest": base_digest,
                     "digest_ref": "python@" + base_digest}, args.output)
        elif args.command == "plan":
            publication_plan = plan(registry, args.repository, args.role, args.identity, args.run_id, args.run_attempt)
            outputs(vars(publication_plan), args.output)
        else:
            qualification = {k: os.environ.get("GATE_" + k.upper(), "") for k in ("contract", "sbom", "trivy")}
            promotion_result = promote(registry, args.repository, args.role, args.identity, args.digest, qualification)
            outputs({"result": promotion_result, "digest_ref": args.repository + "@" + args.digest}, args.output)
    except (ValueError, RuntimeError, OSError, subprocess.CalledProcessError) as exc:
        print(f"Worker publication failed closed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
