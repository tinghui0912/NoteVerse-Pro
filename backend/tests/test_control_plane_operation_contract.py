"""Schema-visible Control Plane operations own explicit semantic identities."""

import json
import re
from pathlib import Path
from fastapi.routing import APIRoute, iter_route_contexts
from tests.support.control_plane import control_app as control_app


def test_operations_declare_unique_semantic_ids_matching_the_committed_contract(control_app):
    spec = control_app.openapi()
    committed = json.loads(
        (Path(__file__).parents[1] / "docs/contracts/openapi/control-plane-api.json").read_text()
    )
    identities = []
    for context in iter_route_contexts(control_app.routes):
        if not isinstance(context.original_route, APIRoute) or not context.include_in_schema:
            continue
        identity = context.operation_id
        assert identity and re.fullmatch(r"[a-z][A-Za-z0-9]*", identity)
        for method in context.methods:
            operation = spec["paths"][context.path_format][method.lower()]
            assert (
                operation["operationId"]
                == identity
                == committed["paths"][context.path_format][method.lower()]["operationId"]
            )
            identities.append(identity)
    assert len(identities) == len(set(identities)) == 10


def test_success_schema_owns_the_direct_representation_or_bodyless_acknowledgement(control_app):
    spec = control_app.openapi()
    refs = {
        "operatorCurrentGet": "OperatorRead",
        "opsAsyncOperationsList": "OffsetPage_AsyncOperationRead_",
        "opsAsyncOperationsSummaryGet": "AsyncOperationsSummaryRead",
        "opsAsyncOperationRetry": "AsyncOperationRead",
        "opsAsyncOperationGet": "AsyncOperationRead",
        "opsAuditEventsList": "OffsetPage_OpsAuditEventRead_",
        "healthLive": "LivenessRead",
        "healthReady": "ReadinessRead",
    }
    for path, methods in spec["paths"].items():
        for operation in methods.values():
            identity = operation["operationId"]
            if identity in {"operatorLogin", "operatorLogout"}:
                assert operation["responses"]["204"] == {"description": "Successful Response"}
            else:
                assert operation["responses"]["200"]["content"]["application/json"]["schema"] == {
                    "$ref": "#/components/schemas/" + refs[identity]
                }
            if path.startswith("/api/v1/"):
                for status in ["default", "422"]:
                    assert operation["responses"][status]["content"]["application/json"][
                        "schema"
                    ] == {"$ref": "#/components/schemas/ControlPlaneErrorResponse"}
    for ref in refs.values():
        assert spec["components"]["schemas"][ref]["type"] == "object"
