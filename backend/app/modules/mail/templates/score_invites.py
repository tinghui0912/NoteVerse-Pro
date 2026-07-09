from __future__ import annotations

from html import escape

from app.modules.mail.templates.base import MailContent, build_html_shell


def build_invite_email(
    *,
    locale: str,
    project_name: str,
    inviter_name: str,
    score_title: str,
    role_label: str,
    invite_url: str,
) -> MailContent:
    if locale == "en":
        return _build_en_invite_email(
            project_name=project_name,
            inviter_name=inviter_name,
            score_title=score_title,
            role_label=role_label,
            invite_url=invite_url,
        )
    return _build_zh_invite_email(
        project_name=project_name,
        inviter_name=inviter_name,
        score_title=score_title,
        role_label=role_label,
        invite_url=invite_url,
    )


def _build_zh_invite_email(
    *,
    project_name: str,
    inviter_name: str,
    score_title: str,
    role_label: str,
    invite_url: str,
) -> MailContent:
    subject = f"{inviter_name} 邀请你协作《{score_title}》"
    text_body = (
        f"{inviter_name} 邀请你在 {project_name} 中协作乐谱《{score_title}》。\n"
        f"权限：{role_label}\n\n"
        f"点击链接接受邀请：\n{invite_url}\n\n"
        "如果你不认识这次邀请，可以忽略这封邮件。"
    )
    html_body = build_html_shell(
        project_name=project_name,
        heading=f"{escape(inviter_name)} 邀请你协作",
        body_html=(
            f"你被邀请在 <strong>{escape(project_name)}</strong> 中协作乐谱 "
            f"<strong>《{escape(score_title)}》</strong>。"
        ),
        extra_html=_build_meta_html(label="权限", value=role_label),
        action_label="接受邀请",
        action_url=invite_url,
        footer="如果你不认识这次邀请，可以忽略这封邮件。",
        action_border_radius="999px",
        max_width=560,
    )
    return MailContent(subject=subject, text_body=text_body, html_body=html_body)


def _build_en_invite_email(
    *,
    project_name: str,
    inviter_name: str,
    score_title: str,
    role_label: str,
    invite_url: str,
) -> MailContent:
    subject = f"{inviter_name} invited you to collaborate on {score_title}"
    text_body = (
        f"{inviter_name} invited you to collaborate on \"{score_title}\" in {project_name}.\n"
        f"Role: {role_label}\n\n"
        f"Open this link to accept the invite:\n{invite_url}\n\n"
        "If you were not expecting this invitation, you can ignore this email."
    )
    html_body = build_html_shell(
        project_name=project_name,
        heading=f"{escape(inviter_name)} invited you to collaborate",
        body_html=(
            f"You were invited to collaborate on <strong>{escape(score_title)}</strong> "
            f"in <strong>{escape(project_name)}</strong>."
        ),
        extra_html=_build_meta_html(label="Role", value=role_label),
        action_label="Accept invite",
        action_url=invite_url,
        footer="If you were not expecting this invitation, you can ignore this email.",
        action_border_radius="999px",
        max_width=560,
    )
    return MailContent(subject=subject, text_body=text_body, html_body=html_body)


def _build_meta_html(*, label: str, value: str) -> str:
    return f"""
                <div style="margin:0 0 24px;padding:14px 16px;border:1px solid #e5e7eb;border-radius:12px;background:#fafafa;">
                  <span style="color:#6b7280;">{escape(label)}：</span>
                  <strong style="color:#111827;">{escape(value)}</strong>
                </div>"""
