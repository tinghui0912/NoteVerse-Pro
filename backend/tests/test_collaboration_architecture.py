"""Invitation, membership, role semantics and bulk projection have explicit owners."""

import ast
from pathlib import Path

from app.modules.collaboration.invitation_service import InvitationService
from app.modules.collaboration.membership_service import MembershipService
from app.modules.collaboration.read_model import CollaborationReadModel
from app.modules.collaboration.repository import CollaborationRepository
from app.modules.score_access import roles
from app.modules.mail.templates.score_invites import invite_role_label
from app.main import app

ROOT = Path(__file__).parents[1] / "app/modules"


def imports(file):
    return {
        node.module: {a.name for a in node.names}
        for node in ast.walk(ast.parse((ROOT / file).read_text(encoding="utf-8")))
        if isinstance(node, ast.ImportFrom)
    }


def test_collaboration_has_distinct_command_and_projection_owners():
    assert InvitationService.__module__ == "app.modules.collaboration.invitation_service"
    assert MembershipService.__module__ == "app.modules.collaboration.membership_service"
    assert CollaborationRepository.__module__ == "app.modules.collaboration.repository"
    assert CollaborationReadModel.__module__ == "app.modules.collaboration.read_model"
    for module in ("invitation_service", "membership_service"):
        assert (
            "ScoreAccessPolicy"
            in imports(f"collaboration/{module}.py")["app.modules.score_access.policy"]
        )
        assert (
            "CollaborationReadModel"
            in imports(f"collaboration/{module}.py")["app.modules.collaboration.read_model"]
        )
    assert (
        "stronger_role"
        in imports("collaboration/invitation_service.py")["app.modules.score_access.roles"]
    )


def test_access_and_invite_acceptance_consume_the_role_authority_and_mail_owns_labels():
    assert (
        "owner_capabilities" in imports("score_access/policy.py")["app.modules.score_access.roles"]
    )
    assert (
        "membership_capabilities"
        in imports("score_access/policy.py")["app.modules.score_access.roles"]
    )
    assert roles.stronger_role.__module__ == "app.modules.score_access.roles"
    assert invite_role_label.__module__ == "app.modules.mail.templates.score_invites"


def test_collaboration_http_representations_describe_email_targets_and_current_members():
    schema = app.openapi()
    components = schema["components"]["schemas"]
    for name in ("InviteRead", "InviteCreatedRead", "PendingInviteRead", "InviteAccessRead"):
        email = components[name]["properties"]["email"]
        if name in {"InviteRead", "InviteCreatedRead"}:
            assert email["anyOf"] == [{"type": "string"}, {"type": "null"}]
        else:
            assert email["type"] == "string"
        assert "email" in components[name]["required"]
    assert set(components["MemberRead"]["properties"]) == {
        "membership_id",
        "display_name",
        "email",
        "avatar_url",
        "role",
        "created_at",
    }
    remove = schema["paths"]["/api/v1/scores/{score_id}/members/{membership_id}"]["delete"]
    assert remove["operationId"] == "scoreMemberRemove"
    assert remove["responses"]["204"] == {"description": "Successful Response"}


def test_successful_invite_acceptance_requires_a_persisted_membership_identity():
    acceptance = app.openapi()["components"]["schemas"]["InviteAcceptRead"]
    assert "membership_id" in acceptance["required"]
    assert acceptance["properties"]["membership_id"] == {
        "title": "Membership Id",
        "type": "integer",
    }
