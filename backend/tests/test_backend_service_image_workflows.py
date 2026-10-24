import copy

import pytest

from scripts.backend_service_image_identity import check_workflow_documents


@pytest.fixture
def documents():
    def caller(role):
        return {
            "on": {"pull_request": {}, "push": {"branches": ["main"]}, "workflow_dispatch": None},
            "permissions": {"contents": "read"},
            "concurrency": {"group": f"backend-{role}-image-${{{{ github.ref }}}}", "cancel-in-progress": "${{ github.event_name == 'pull_request' }}"},
            "jobs": {
                "validate": {"if": "github.event_name == 'pull_request'", "permissions": {"contents": "read"}, "steps": [
                    {"uses": "actions/checkout@pin"},
                    {"uses": "./.github/actions/backend-service-image", "with": {"role": role, "publish": "false"}},
                ]},
                "publish": {"if": "github.ref == 'refs/heads/main' && (github.event_name == 'push' || github.event_name == 'workflow_dispatch')", "permissions": {"contents": "read", "packages": "write"}, "steps": [
                    {"uses": "actions/checkout@pin"}, {"uses": "docker/login-action@pin"},
                    {"uses": "./.github/actions/backend-service-image", "with": {"role": role, "publish": "true"}},
                ]},
            },
        }
    bindings = {"REPOSITORY": "${{ steps.image.outputs.repository }}", "ROLE": "${{ inputs.role }}"}
    prefix = 'python3 backend/scripts/backend_service_image_identity.py --output "$GITHUB_OUTPUT"'
    steps = [
        {"id": "image", "run": "echo bounded inputs"},
        {"id": "buildx", "uses": "docker/setup-buildx-action@pin"},
        {"id": "local", "if": "inputs.publish != 'true'", "env": {"ROLE": "${{ inputs.role }}"}, "run": prefix + ' local --role "$ROLE" --run-id "$GITHUB_RUN_ID" --run-attempt "$GITHUB_RUN_ATTEMPT"'},
        {"id": "plan", "if": "inputs.publish == 'true'", "env": bindings | {"SOURCE": "${{ github.sha }}"}, "run": prefix + ' plan --repository "$REPOSITORY" --role "$ROLE" --source "$SOURCE" --run-id "$GITHUB_RUN_ID" --run-attempt "$GITHUB_RUN_ATTEMPT"'},
        {"id": "build", "uses": "docker/build-push-action@pin", "with": {
            "push": "${{ inputs.publish == 'true' }}", "load": "${{ inputs.publish != 'true' }}",
            "tags": "${{ inputs.publish == 'true' && steps.plan.outputs.candidate_ref || steps.local.outputs.ref }}",
        }},
        {"id": "artifact", "env": bindings | {"PUBLISH": "${{ inputs.publish }}", "DIGEST": "${{ steps.build.outputs.digest }}", "LOCAL_REF": "${{ steps.local.outputs.ref }}"}, "run": prefix + ' select --repository "$REPOSITORY" --role "$ROLE" --publish "$PUBLISH" --digest "$DIGEST" --local-ref "$LOCAL_REF"'},
        {"id": "pull", "if": "inputs.publish == 'true'", "env": {"IMAGE_REF": "${{ steps.artifact.outputs.ref }}"}, "run": 'docker pull "$IMAGE_REF"'},
        {"id": "contract", "env": {"IMAGE_REF": "${{ steps.artifact.outputs.ref }}", "ROLE": "${{ inputs.role }}"}, "run": 'docker run --rm --network none --entrypoint python "$IMAGE_REF" scripts/check_image_contract.py --role "$ROLE"'},
        {"id": "sbom", "uses": "anchore/sbom-action@pin", "with": {"image": "${{ steps.artifact.outputs.ref }}", "format": "spdx-json"}},
        {"id": "scan", "uses": "aquasecurity/trivy-action@pin", "with": {"image-ref": "${{ steps.artifact.outputs.ref }}", "vuln-type": "os,library", "severity": "CRITICAL", "ignore-unfixed": True, "exit-code": "1"}},
        {"id": "promote", "if": "inputs.publish == 'true' && success()", "env": bindings | {"SOURCE": "${{ github.sha }}", "DIGEST": "${{ steps.build.outputs.digest }}", "GATE_CONTRACT": "${{ steps.contract.outcome }}", "GATE_SBOM": "${{ steps.sbom.outcome }}", "GATE_TRIVY": "${{ steps.scan.outcome }}"}, "run": prefix + ' promote --repository "$REPOSITORY" --role "$ROLE" --source "$SOURCE" --digest "$DIGEST"'},
        {"id": "summary", "run": "echo qualified summary"},
    ]
    action = {"inputs": {"role": {"required": True}, "publish": {"default": "false"}}, "runs": {"using": "composite", "steps": steps}}
    return caller("api"), caller("beat"), action


def step(documents, name):
    return next(s for s in documents[2]["runs"]["steps"] if s["id"] == name)


def test_valid_api_beat_trust_and_promotion_contract(documents):
    check_workflow_documents(*documents)


@pytest.mark.parametrize("workflow", [0, 1])
@pytest.mark.parametrize("job", [None, "validate"])
def test_pr_package_write_is_rejected(documents, workflow, job):
    target = documents[workflow] if job is None else documents[workflow]["jobs"][job]
    target["permissions"]["packages"] = "write"
    with pytest.raises(ValueError):
        check_workflow_documents(*documents)


def test_publish_write_permission_is_explicit_and_scoped(documents):
    documents[0]["jobs"]["publish"]["permissions"].pop("packages")
    with pytest.raises(ValueError, match="trusted publication"):
        check_workflow_documents(*documents)


@pytest.mark.parametrize("job", ["validate", "publish"])
def test_event_main_guards_cannot_be_weakened(documents, job):
    documents[0]["jobs"][job]["if"] = "always()"
    with pytest.raises(ValueError, match="trust boundary"):
        check_workflow_documents(*documents)


def test_extra_job_cannot_bypass_governance(documents):
    documents[0]["jobs"]["other"] = copy.deepcopy(documents[0]["jobs"]["publish"])
    with pytest.raises(ValueError):
        check_workflow_documents(*documents)


def test_pull_request_target_is_not_an_authorized_event(documents):
    documents[0]["on"]["pull_request_target"] = {}
    with pytest.raises(ValueError, match="events"):
        check_workflow_documents(*documents)


def test_pr_login_is_rejected(documents):
    documents[0]["jobs"]["validate"]["steps"].insert(0, {"uses": "docker/login-action@pin"})
    with pytest.raises(ValueError, match="authenticate"):
        check_workflow_documents(*documents)


def test_pr_cannot_select_publication_mode(documents):
    documents[0]["jobs"]["validate"]["steps"][-1]["with"]["publish"] = "true"
    with pytest.raises(ValueError, match="bounded role"):
        check_workflow_documents(*documents)


def test_caller_cannot_inline_registry_commands(documents):
    documents[0]["jobs"]["validate"]["steps"].append({"run": "docker push image"})
    with pytest.raises(ValueError, match="governed composite"):
        check_workflow_documents(*documents)


@pytest.mark.parametrize("cancel", [True, False])
def test_concurrency_must_cancel_only_pr_runs(documents, cancel):
    documents[0]["concurrency"]["cancel-in-progress"] = cancel
    with pytest.raises(ValueError, match="serialize"):
        check_workflow_documents(*documents)


@pytest.mark.parametrize("tag", ["${{ github.sha }}", "build-${{ github.run_id }}", "ghcr.io/owner/noteverse/backend-api:latest"])
def test_buildx_cannot_assign_canonical_or_build_alias_tags(documents, tag):
    step(documents, "build")["with"]["tags"] = tag
    with pytest.raises(ValueError, match="only trusted candidates"):
        check_workflow_documents(*documents)


def test_buildx_cannot_push_from_pr_mode(documents):
    step(documents, "build")["with"]["push"] = True
    with pytest.raises(ValueError, match="only trusted candidates"):
        check_workflow_documents(*documents)


@pytest.mark.parametrize("name", ["plan", "pull", "promote"])
def test_pr_cannot_run_trusted_registry_stages(documents, name):
    step(documents, name)["if"] = "always()"
    with pytest.raises(ValueError):
        check_workflow_documents(*documents)


def test_build_cannot_bypass_planning_failure(documents):
    step(documents, "build")["if"] = "always()"
    with pytest.raises(ValueError, match="planning"):
        check_workflow_documents(*documents)


def test_promotion_cannot_precede_qualification(documents):
    steps = documents[2]["runs"]["steps"]
    promotion = step(documents, "promote")
    steps.remove(promotion)
    steps.insert(0, promotion)
    with pytest.raises(ValueError, match="precede promotion"):
        check_workflow_documents(*documents)


@pytest.mark.parametrize("name", ["contract", "sbom", "scan", "promote"])
def test_gate_or_promotion_failure_cannot_be_ignored(documents, name):
    step(documents, name)["continue-on-error"] = True
    with pytest.raises(ValueError):
        check_workflow_documents(*documents)


@pytest.mark.parametrize("gate", ["GATE_CONTRACT", "GATE_SBOM", "GATE_TRIVY"])
def test_promotion_must_consume_actual_gate_outcomes(documents, gate):
    step(documents, "promote")["env"][gate] = "success"
    with pytest.raises(ValueError, match="actual qualification"):
        check_workflow_documents(*documents)


@pytest.mark.parametrize("name,key", [("sbom", "image"), ("scan", "image-ref")])
def test_security_evidence_must_use_selected_artifact(documents, name, key):
    step(documents, name)["with"][key] = "mutable:tag"
    with pytest.raises(ValueError, match="same selected"):
        check_workflow_documents(*documents)


def test_sbom_must_remain_spdx(documents):
    step(documents, "sbom")["with"]["format"] = "table"
    with pytest.raises(ValueError, match="SPDX"):
        check_workflow_documents(*documents)


@pytest.mark.parametrize("key,value", [("severity", "HIGH"), ("vuln-type", "os"), ("ignore-unfixed", False), ("exit-code", "0")])
def test_trivy_policy_cannot_be_weakened(documents, key, value):
    step(documents, "scan")["with"][key] = value
    with pytest.raises(ValueError, match="Trivy policy"):
        check_workflow_documents(*documents)


def test_contract_must_remain_offline(documents):
    contract = step(documents, "contract")
    contract["run"] = contract["run"].replace("--network none", "--network host")
    with pytest.raises(ValueError, match="offline"):
        check_workflow_documents(*documents)


def test_promotion_cannot_select_a_different_digest(documents):
    step(documents, "promote")["env"]["DIGEST"] = "${{ github.sha }}"
    with pytest.raises(ValueError, match="same source and candidate"):
        check_workflow_documents(*documents)


def test_unrecognized_step_cannot_push_around_gates(documents):
    documents[2]["runs"]["steps"].append({"id": "escape", "run": "docker push source"})
    with pytest.raises(ValueError):
        check_workflow_documents(*documents)


def test_inline_registry_tag_assignment_is_forbidden(documents):
    step(documents, "image")["run"] = "docker buildx imagetools create --tag canonical candidate"
    with pytest.raises(ValueError, match="Inline registry"):
        check_workflow_documents(*documents)


def test_helper_promotion_cannot_be_moved_outside_governed_stage(documents):
    step(documents, "image")["run"] = step(documents, "promote")["run"]
    with pytest.raises(ValueError, match="bypass"):
        check_workflow_documents(*documents)
