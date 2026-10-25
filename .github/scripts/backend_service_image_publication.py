"""API/Beat source-tag policy and parsed workflow governance, never resolution."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import re
import subprocess
import sys

from oci_publication import (
    DockerRegistry, Plan, Registry, candidate_tag, outputs, promote_qualified, validate_digest,
)


def validate_repository(repository: str, role: str) -> str:
    if role not in ("api", "beat") or not re.fullmatch(
        r"ghcr\.io/[a-z0-9_.-]+/noteverse/backend-" + role, repository,
    ):
        raise ValueError("Service role/repository mismatch; only NoteVerse API/Beat are supported")
    return repository


def source_tag(source: str) -> str:
    if not re.fullmatch(r"[a-f0-9]{40}", source):
        raise ValueError("Canonical service identity must be a full source SHA")
    return source


def plan(registry: Registry, repository: str, role: str, source: str, run: str, attempt: str) -> Plan:
    validate_repository(repository, role)
    canonical = repository + ":" + source_tag(source)
    candidate = repository + ":" + candidate_tag(run, attempt)
    if registry.resolve(canonical) is not None:
        raise RuntimeError("Service source canonical already exists; refuse recomposition or overwrite")
    if registry.resolve(candidate) is not None:
        raise RuntimeError("Run-attempt candidate already exists; refuse overwrite")
    return Plan("build", canonical, candidate, "", "")


def promote(registry: Registry, repository: str, role: str, source: str, digest: str,
            qualification: dict[str, str]) -> str:
    validate_repository(repository, role)
    return promote_qualified(registry, repository, source_tag(source), digest, qualification)


TRUSTED_IF = "${{ inputs.publish == 'true' }}"
LOCAL_IF = "${{ inputs.publish != 'true' }}"
BUILD_TAG = "${{ inputs.publish == 'true' && steps.plan.outputs.candidate_ref || steps.image.outputs.local_ref }}"
ARTIFACT_REF = "${{ steps.artifact.outputs.ref }}"


def check_workflow_documents(api: dict, beat: dict, action: dict) -> None:
    """Enforce the small service orchestration, including its trust branches."""
    for role, document in (("api", api), ("beat", beat)):
        concurrency = document["concurrency"]
        expected_group = "backend-" + role + "-image-${{ github.event_name == 'pull_request' && github.ref || 'trusted-main' }}"
        if concurrency != {"group": expected_group, "cancel-in-progress": "${{ github.event_name == 'pull_request' }}"}:
            raise ValueError("Trusted service publication must serialize; only PR runs may cancel")
        if document["permissions"] != {"contents": "read"}:
            raise ValueError("Workflow default must be contents-read only")
        pr, trusted = document["jobs"]["validate"], document["jobs"]["publish"]
        if pr["if"] != "github.event_name == 'pull_request'" or pr["permissions"] != {"contents": "read"}:
            raise ValueError("PR permissions/event must remain read-only")
        for step in pr["steps"]:
            if "login-action" in step.get("uses", "") or re.search(r"--push|docker\s+push|imagetools\s+create|\b(?:plan|promote)\b", step.get("run", "")):
                raise ValueError("PR cannot login, plan publication, push or promote")
            if step.get("uses") == "./.github/actions/backend-service-image" and step["with"] != {"role": role, "publish": "false"}:
                raise ValueError("PR service action must remain local-only")
        if len([s for s in pr["steps"] if s.get("uses") == "./.github/actions/backend-service-image"]) != 1:
            raise ValueError("PR must execute exactly one local service validation")
        if trusted["permissions"] != {"contents": "read", "packages": "write"}:
            raise ValueError("Only trusted publication may write packages")
        trusted_condition = " ".join(trusted["if"].split())
        if trusted_condition != "github.ref == 'refs/heads/main' && (github.event_name == 'push' || github.event_name == 'workflow_dispatch')":
            raise ValueError("Trusted service publication must be main push/manual only")
        calls = [s for s in trusted["steps"] if s.get("uses") == "./.github/actions/backend-service-image"]
        if len(calls) != 1 or calls[0]["with"] != {"role": role, "publish": "true"}:
            raise ValueError("Trusted publication must use the governed service action")

    steps = {s["id"]: s for s in action["runs"]["steps"] if "id" in s}
    order = [s.get("id") for s in action["runs"]["steps"]]
    for step in action["runs"]["steps"]:
        if "login-action" in step.get("uses", ""):
            raise ValueError("Composite action cannot authenticate PRs; trusted credentials stay in caller")
        run = step.get("run", "")
        if re.search(r"docker\s+push|--push|imagetools\s+create|backend_service_image_publication\.py[^\n]*\b(?:plan|promote)\b", run):
            if step.get("if") != TRUSTED_IF:
                raise ValueError("PR action path cannot plan, publish or promote")
    for name in ("plan", "trusted-artifact", "promote"):
        if steps[name].get("if") != TRUSTED_IF or steps[name].get("continue-on-error", False):
            raise ValueError("Registry planning/selection/promotion must be trusted-only and fail closed")
    if steps["local-artifact"].get("if") != LOCAL_IF:
        raise ValueError("Local image selection must remain PR-only")
    if "noteverse-backend-${ROLE}:pr-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}" not in steps["image"]["run"]:
        raise ValueError("PR images require local noncanonical run-attempt tags")
    build = steps["build"]["with"]
    if build["tags"] != BUILD_TAG or build["push"] != "${{ inputs.publish == 'true' }}" or build["load"] != "${{ inputs.publish != 'true' }}":
        raise ValueError("Trusted Buildx may push only its candidate; PR builds must load locally")
    commands = "\n".join(s.get("run", "") for s in action["runs"]["steps"])
    if "build-${" in commands or any("build-${" in str(s.get("with", {}).get("tags", "")) for s in steps.values()):
        raise ValueError("Build-run publication aliases are forbidden")
    if order.index("plan") >= order.index("build"):
        raise ValueError("Publication preflight must precede Buildx mutation")
    if "docker pull" not in steps["trusted-artifact"]["run"] or "@${DIGEST}" not in steps["trusted-artifact"]["run"]:
        raise ValueError("Trusted qualification requires an explicit exact-digest pull")
    for name in ("trusted-artifact", "promote"):
        if steps[name]["env"].get("DIGEST") != "${{ steps.build.outputs.digest }}":
            raise ValueError("Qualification and promotion must use the same Buildx OCI")
    if steps["artifact"]["env"]["REF"] != "${{ inputs.publish == 'true' && steps.trusted-artifact.outputs.ref || steps.local-artifact.outputs.ref }}":
        raise ValueError("All gates must select the validated trusted OCI or local PR ref")
    if steps["contract"]["env"]["IMAGE_REF"] != ARTIFACT_REF or "--network none" not in steps["contract"]["run"]:
        raise ValueError("Packaging contract must evaluate the selected artifact offline")
    if steps["sbom"]["with"]["image"] != ARTIFACT_REF or steps["scan"]["with"]["image-ref"] != ARTIFACT_REF:
        raise ValueError("SBOM/Trivy must evaluate the selected immutable trusted digest")
    policy = steps["scan"]["with"]
    if (policy["vuln-type"], policy["severity"], policy["ignore-unfixed"], str(policy["exit-code"])) != ("os,library", "CRITICAL", True, "1"):
        raise ValueError("Service CRITICAL Trivy policy changed")
    for gate, name in (("CONTRACT", "contract"), ("SBOM", "sbom"), ("TRIVY", "scan")):
        if order.index(name) >= order.index("promote") or steps[name].get("continue-on-error", False):
            raise ValueError("Canonical promotion must follow all successful gates")
        if steps["promote"]["env"].get("GATE_" + gate) != "${{ steps." + name + ".outcome }}":
            raise ValueError("Promotion must consume all three actual gate outcomes")


def check_workflows(repo: Path) -> None:
    import yaml

    def read(path: str) -> dict:
        return yaml.safe_load((repo / path).read_text(encoding="utf-8"))
    check_workflow_documents(read(".github/workflows/backend-api-image.yml"),
                             read(".github/workflows/backend-beat-image.yml"),
                             read(".github/actions/backend-service-image/action.yml"))
    print("API/Beat parsed YAML candidate/digest/gate/promotion/read-only contracts passed")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    sub = parser.add_subparsers(dest="command", required=True)
    workflows = sub.add_parser("check-workflows")
    workflows.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[2])
    for name in ("plan", "select", "promote"):
        command = sub.add_parser(name)
        command.add_argument("--repository", required=True)
        command.add_argument("--role", choices=("api", "beat"), required=True)
        if name != "select":
            command.add_argument("--source", required=True)
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
        elif args.command == "plan":
            outputs(vars(plan(registry, args.repository, args.role, args.source, args.run_id, args.run_attempt)), args.output)
        elif args.command == "select":
            validate_repository(args.repository, args.role)
            digest = validate_digest(args.digest)
            outputs({"ref": args.repository + "@" + digest, "oci_digest": digest}, args.output)
        else:
            gates = {k: os.environ.get("GATE_" + k.upper(), "") for k in ("contract", "sbom", "trivy")}
            result = promote(registry, args.repository, args.role, args.source, args.digest, gates)
            outputs({"result": result, "canonical_ref": args.repository + ":" + source_tag(args.source)}, args.output)
    except (ValueError, RuntimeError, OSError, subprocess.CalledProcessError) as exc:
        print(f"Service publication failed closed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
