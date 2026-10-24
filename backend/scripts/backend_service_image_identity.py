"""API/Beat candidate qualification and fail-closed source-tag promotion.

Intentionally isolated from the already-qualified Worker v2 identity inputs.
Workflow serialization is not registry-server CAS against external writers.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from typing import Protocol

REPOSITORY = re.compile(r"ghcr\.io/[a-z0-9][a-z0-9_.-]*/noteverse/backend-(api|beat)")
DIGEST = re.compile(r"sha256:[a-f0-9]{64}")
SOURCE = re.compile(r"[a-f0-9]{40}")
TRUSTED = "inputs.publish == 'true'"
LOCAL = "inputs.publish != 'true'"
CANCEL_PR = "${{ github.event_name == 'pull_request' }}"
BUILD_TAG = "${{ inputs.publish == 'true' && steps.plan.outputs.candidate_ref || steps.local.outputs.ref }}"
SELECT_COMMAND = ('python3 backend/scripts/backend_service_image_identity.py --output "$GITHUB_OUTPUT" select '
                  '--repository "$REPOSITORY" --role "$ROLE" --publish "$PUBLISH" '
                  '--digest "$DIGEST" --local-ref "$LOCAL_REF"')
LOCAL_COMMAND = ('python3 backend/scripts/backend_service_image_identity.py --output "$GITHUB_OUTPUT" local '
                 '--role "$ROLE" --run-id "$GITHUB_RUN_ID" --run-attempt "$GITHUB_RUN_ATTEMPT"')
PLAN_COMMAND = ('python3 backend/scripts/backend_service_image_identity.py --output "$GITHUB_OUTPUT" plan '
                '--repository "$REPOSITORY" --role "$ROLE" --source "$SOURCE" '
                '--run-id "$GITHUB_RUN_ID" --run-attempt "$GITHUB_RUN_ATTEMPT"')
PROMOTE_COMMAND = ('python3 backend/scripts/backend_service_image_identity.py --output "$GITHUB_OUTPUT" promote '
                   '--repository "$REPOSITORY" --role "$ROLE" --source "$SOURCE" --digest "$DIGEST"')


def validate_role(role: str) -> None:
    if role not in ("api", "beat"):
        raise ValueError("Only API and Beat artifacts are supported")


def validate_repository(repository: str, role: str) -> None:
    validate_role(role)
    match = REPOSITORY.fullmatch(repository)
    if not match or match.group(1) != role:
        raise ValueError("API/Beat role and GHCR repository mismatch")


def validate_source(source: str) -> None:
    if not SOURCE.fullmatch(source):
        raise ValueError("Expected a full lowercase source SHA")


def validate_digest(digest: str) -> None:
    if not DIGEST.fullmatch(digest):
        raise ValueError("Expected a lowercase sha256 OCI digest")


def candidate_tag(run: str, attempt: str) -> str:
    if not re.fullmatch(r"[1-9][0-9]*", run) or not re.fullmatch(r"[1-9][0-9]*", attempt):
        raise ValueError("Candidate requires positive run ID and attempt")
    return f"candidate-{run}-{attempt}"


def local_ref(role: str, run: str, attempt: str) -> str:
    validate_role(role)
    candidate_tag(run, attempt)
    return f"noteverse-backend-{role}:pr-{run}-{attempt}"


def _registry_error_is_absence(stderr: str, reference: str) -> bool:
    """Match complete diagnostics; identifiers are never HTTP/auth evidence."""
    message = stderr.strip().lower().removeprefix("error: ")
    reference = reference.lower()
    return message in {
        reference + ": not found", "manifest unknown", "manifest unknown: manifest unknown",
        reference + ": manifest unknown", reference + ": manifest unknown: manifest unknown",
    }


class Registry(Protocol):
    def resolve(self, reference: str) -> str | None: ...
    def attach(self, source: str, target: str) -> None: ...


class DockerRegistry:
    def resolve(self, reference: str) -> str | None:
        result = subprocess.run(
            ["docker", "buildx", "imagetools", "inspect", reference], capture_output=True, text=True,
        )
        if result.returncode:
            if _registry_error_is_absence(result.stderr, reference):
                return None
            raise RuntimeError(f"Service registry lookup failed closed: {result.stderr}")
        match = re.search(r"^Digest:\s+(sha256:[a-f0-9]{64})\s*$", result.stdout, re.M)
        if not match:
            raise ValueError("Registry did not return a valid OCI digest")
        return match.group(1)

    def attach(self, source: str, target: str) -> None:
        subprocess.run([
            "docker", "buildx", "imagetools", "create", "--prefer-index=false", "--tag", target, source,
        ], check=True)


@dataclass(frozen=True)
class Plan:
    action: str
    canonical_ref: str
    candidate_ref: str


def plan(registry: Registry, repository: str, role: str, source: str, run: str, attempt: str) -> Plan:
    validate_repository(repository, role)
    validate_source(source)
    canonical = repository + ":" + source
    candidate = repository + ":" + candidate_tag(run, attempt)
    if registry.resolve(canonical) is not None:
        raise RuntimeError("Source canonical already exists; refuse rebuild, overwrite or provenance inference")
    if registry.resolve(candidate) is not None:
        raise RuntimeError("Attempt-specific candidate already exists; refuse overwrite")
    return Plan("build", canonical, candidate)


def select_artifact(repository: str, role: str, *, publish: bool, digest: str, local: str) -> str:
    validate_repository(repository, role)
    if publish:
        validate_digest(digest)
        return repository + "@" + digest
    if not re.fullmatch(r"noteverse-backend-" + role + r":pr-[1-9][0-9]*-[1-9][0-9]*", local):
        raise ValueError("PR artifact must use a local-only run-attempt tag")
    return local


def promote(registry: Registry, repository: str, role: str, source: str, digest: str,
            qualification: dict[str, str]) -> str:
    validate_repository(repository, role)
    validate_source(source)
    validate_digest(digest)
    if set(qualification) != {"contract", "sbom", "trivy"} or any(v != "success" for v in qualification.values()):
        raise ValueError("Promotion denied: contract, SBOM and Trivy must all succeed")
    target = repository + ":" + source
    existing = registry.resolve(target)
    if existing is not None:
        validate_digest(existing)
        if existing != digest:
            raise RuntimeError("Different canonical winner exists; never overwrite")
        return "same-winner-without-repush"
    registry.attach(repository + "@" + digest, target)
    if registry.resolve(target) != digest:
        raise RuntimeError("Canonical promotion changed the candidate OCI digest")
    return "promoted-qualified-oci"


def check_workflow_documents(api: dict, beat: dict, action: dict) -> None:
    """Enforce the bounded API/Beat callers and composite publication contract."""
    for role, workflow in (("api", api), ("beat", beat)):
        events = workflow.get("on", workflow.get(True))
        if not isinstance(events, dict) or set(events) != {"push", "pull_request", "workflow_dispatch"} or events["push"]["branches"] != ["main"]:
            raise ValueError("Only PR validation and trusted main publication events are supported")
        if workflow["permissions"] != {"contents": "read"} or set(workflow["jobs"]) != {"validate", "publish"}:
            raise ValueError("Service callers must separate read-only validation and trusted publication")
        concurrency = workflow["concurrency"]
        if concurrency != {"group": f"backend-{role}-image-${{{{ github.ref }}}}", "cancel-in-progress": CANCEL_PR}:
            raise ValueError("Only PR runs may cancel superseded runs; trusted main must serialize")
        for job_id, publish in (("validate", "false"), ("publish", "true")):
            job = workflow["jobs"][job_id]
            expected = {"contents": "read"} if job_id == "validate" else {"contents": "read", "packages": "write"}
            if job["permissions"] != expected:
                raise ValueError("Only the trusted publication job may write packages")
            condition = " ".join(job["if"].split())
            wanted = ("github.event_name == 'pull_request'" if job_id == "validate" else
                      "github.ref == 'refs/heads/main' && (github.event_name == 'push' || github.event_name == 'workflow_dispatch')")
            if condition != wanted:
                raise ValueError("Service event/main trust boundary changed")
            calls = [s for s in job["steps"] if s.get("uses") == "./.github/actions/backend-service-image"]
            if len(calls) != 1 or calls[0]["with"] != {"role": role, "publish": publish}:
                raise ValueError("Service caller must use the bounded role/publication mode")
            logins = [s for s in job["steps"] if "login-action" in s.get("uses", "")]
            if len(logins) != (1 if job_id == "publish" else 0):
                raise ValueError("PR validation cannot authenticate to the registry")
            if any("run" in s for s in job["steps"]):
                raise ValueError("Registry/build commands must stay in the governed composite action")
            allowed: tuple[str, ...] = ("actions/checkout@", "./.github/actions/backend-service-image")
            if job_id == "publish":
                allowed += ("docker/login-action@",)
            if any(not s.get("uses", "").startswith(allowed) for s in job["steps"]):
                raise ValueError("Unreviewed service caller action")
    if set(action["inputs"]) != {"role", "publish"} or action["inputs"]["publish"]["default"] != "false" or action["runs"]["using"] != "composite":
        raise ValueError("Composite must default to read-only validation")
    ordered = action["runs"]["steps"]
    steps = {s["id"]: s for s in ordered if "id" in s}
    order = [s.get("id") for s in ordered]
    required = ["local", "plan", "build", "artifact", "pull", "contract", "sbom", "scan", "promote"]
    if set(order) != set(required + ["image", "buildx", "summary"]) or len(order) != len(set(order)):
        raise ValueError("Unique service build/qualification/promotion steps are required")
    uses = {"buildx": "docker/setup-buildx-action@", "build": "docker/build-push-action@", "sbom": "anchore/sbom-action@", "scan": "aquasecurity/trivy-action@"}
    for step in ordered:
        if "uses" in step and not step["uses"].startswith(uses.get(step["id"], "!unsupported!")):
            raise ValueError("Unreviewed service composite action")
        if re.search(r"\bdocker\s+(?:push|login)\b|\bimagetools\s+create\b", step.get("run", "")):
            raise ValueError("Inline registry publication/authentication is forbidden")
        if "backend_service_image_identity.py" in step.get("run", "") and step["id"] not in ("local", "plan", "artifact", "promote"):
            raise ValueError("Identity operations cannot bypass the governed stages")
    if steps["local"]["if"] != LOCAL or steps["plan"]["if"] != TRUSTED or steps["pull"]["if"] != TRUSTED:
        raise ValueError("PR must not plan registry state or pull a published service artifact")
    build = steps["build"]["with"]
    if (build["push"], build["load"], build["tags"]) != ("${{ inputs.publish == 'true' }}", "${{ inputs.publish != 'true' }}", BUILD_TAG):
        raise ValueError("Buildx must push only trusted candidates, or load local-only PR tags")
    if steps["build"].get("if", "success()") != "success()":
        raise ValueError("Build must not bypass failed planning")
    for step_id, command in (("local", LOCAL_COMMAND), ("plan", PLAN_COMMAND), ("promote", PROMOTE_COMMAND)):
        if " ".join(steps[step_id]["run"].split()) != command:
            raise ValueError("Service identity operations must use their bounded helper")
    bindings = {"REPOSITORY": "${{ steps.image.outputs.repository }}", "ROLE": "${{ inputs.role }}"}
    if steps["plan"]["env"] != bindings | {"SOURCE": "${{ github.sha }}"} or steps["local"]["env"] != {"ROLE": "${{ inputs.role }}"}:
        raise ValueError("Service source/role/repository authority changed")
    if steps["artifact"]["env"] != bindings | {"PUBLISH": "${{ inputs.publish }}", "DIGEST": "${{ steps.build.outputs.digest }}", "LOCAL_REF": "${{ steps.local.outputs.ref }}"}:
        raise ValueError("Artifact selection must bind to Buildx or the controlled local ref")
    if " ".join(steps["artifact"]["run"].split()) != SELECT_COMMAND:
        raise ValueError("Artifact selection must validate the candidate digest or local-only PR ref")
    if steps["pull"]["run"] != 'docker pull "$IMAGE_REF"' or steps["pull"]["env"]["IMAGE_REF"] != "${{ steps.artifact.outputs.ref }}":
        raise ValueError("Trusted qualification must explicitly pull the selected OCI")
    if steps["contract"]["run"] != 'docker run --rm --network none --entrypoint python "$IMAGE_REF" scripts/check_image_contract.py --role "$ROLE"':
        raise ValueError("Packaging contract must run offline against the selected artifact")
    if steps["contract"]["env"] != {"IMAGE_REF": "${{ steps.artifact.outputs.ref }}", "ROLE": "${{ inputs.role }}"}:
        raise ValueError("Contract artifact/role binding changed")
    if steps["sbom"]["with"]["image"] != "${{ steps.artifact.outputs.ref }}" or steps["scan"]["with"]["image-ref"] != "${{ steps.artifact.outputs.ref }}":
        raise ValueError("SBOM and Trivy must use the same selected artifact")
    if steps["sbom"]["with"]["format"] != "spdx-json":
        raise ValueError("SPDX JSON evidence is required")
    scan = steps["scan"]["with"]
    if (scan["vuln-type"], scan["severity"], scan["ignore-unfixed"], str(scan["exit-code"])) != ("os,library", "CRITICAL", True, "1"):
        raise ValueError("Service Trivy policy changed")
    promotion = steps["promote"]
    if promotion["if"] != TRUSTED + " && success()":
        raise ValueError("PR or failed qualification must never promote")
    for gate, step_id in (("CONTRACT", "contract"), ("SBOM", "sbom"), ("TRIVY", "scan")):
        if order.index(step_id) >= order.index("promote") or steps[step_id].get("continue-on-error", False) or steps[step_id].get("if", "success()") != "success()":
            raise ValueError("Successful gates must precede promotion")
        if promotion["env"]["GATE_" + gate] != "${{ steps." + step_id + ".outcome }}":
            raise ValueError("Promotion must consume all actual qualification outcomes")
    if promotion.get("continue-on-error", False):
        raise ValueError("Promotion failure must fail publication")
    if promotion["env"] != bindings | {"SOURCE": "${{ github.sha }}", "DIGEST": "${{ steps.build.outputs.digest }}", "GATE_CONTRACT": "${{ steps.contract.outcome }}", "GATE_SBOM": "${{ steps.sbom.outcome }}", "GATE_TRIVY": "${{ steps.scan.outcome }}"}:
        raise ValueError("Promotion must bind the same source and candidate digest")
    if not order.index("plan") < order.index("build") < order.index("artifact") < order.index("pull") < order.index("contract") < order.index("sbom") < order.index("scan"):
        raise ValueError("Service qualification execution order changed")


def check_workflows(repo: Path) -> None:
    import yaml

    def load(path: str) -> dict:
        return yaml.safe_load((repo / path).read_text(encoding="utf-8"))
    check_workflow_documents(
        load(".github/workflows/backend-api-image.yml"), load(".github/workflows/backend-beat-image.yml"),
        load(".github/actions/backend-service-image/action.yml"),
    )
    print("API/Beat workflow candidate/qualification/promotion/read-only contracts passed")


def outputs(values: dict[str, str], output: Path | None) -> None:
    if any("\n" in value or "\r" in value for value in values.values()):
        raise ValueError("Invalid multiline step output")
    if output:
        with output.open("a", encoding="utf-8", newline="\n") as stream:
            for key, value in values.items():
                stream.write(f"{key}={value}\n")
    print(json.dumps(values, sort_keys=True))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    sub = parser.add_subparsers(dest="command", required=True)
    workflow = sub.add_parser("check-workflows")
    workflow.add_argument("--repo", type=Path, default=Path(__file__).resolve().parents[2])
    for name in ("local", "plan", "select", "promote"):
        command = sub.add_parser(name)
        command.add_argument("--role", choices=("api", "beat"), required=True)
        if name != "local":
            command.add_argument("--repository", required=True)
        if name in ("local", "plan"):
            command.add_argument("--run-id", required=True)
            command.add_argument("--run-attempt", required=True)
        if name in ("plan", "promote"):
            command.add_argument("--source", required=True)
        if name in ("select", "promote"):
            command.add_argument("--digest", required=True)
        if name == "select":
            command.add_argument("--publish", choices=("true", "false"), required=True)
            command.add_argument("--local-ref", required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "check-workflows":
            check_workflows(args.repo)
        elif args.command == "local":
            outputs({"ref": local_ref(args.role, args.run_id, args.run_attempt)}, args.output)
        elif args.command == "select":
            outputs({"ref": select_artifact(args.repository, args.role, publish=args.publish == "true", digest=args.digest, local=args.local_ref)}, args.output)
        elif args.command == "plan":
            result = plan(DockerRegistry(), args.repository, args.role, args.source, args.run_id, args.run_attempt)
            outputs(vars(result), args.output)
        else:
            gates = {name: os.environ.get("GATE_" + name.upper(), "") for name in ("contract", "sbom", "trivy")}
            outcome = promote(DockerRegistry(), args.repository, args.role, args.source, args.digest, gates)
            outputs({"result": outcome, "canonical_ref": args.repository + ":" + args.source, "digest_ref": args.repository + "@" + args.digest}, args.output)
    except (ValueError, RuntimeError, OSError, subprocess.CalledProcessError) as exc:
        print(f"API/Beat identity failed closed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
