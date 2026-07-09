from __future__ import annotations

from dataclasses import dataclass
from html import escape

from app.db.models.score_access import MembershipRole


@dataclass(frozen=True)
class InviteEmailContent:
    subject: str
    text_body: str
    html_body: str


def build_invite_email(
    *,
    locale: str,
    project_name: str,
    inviter_name: str,
    score_title: str,
    role: MembershipRole,
    invite_url: str,
) -> InviteEmailContent:
    if locale == "en":
        return _build_en_invite_email(
            project_name=project_name,
            inviter_name=inviter_name,
            score_title=score_title,
            role=role,
            invite_url=invite_url,
        )
    return _build_zh_invite_email(
        project_name=project_name,
        inviter_name=inviter_name,
        score_title=score_title,
        role=role,
        invite_url=invite_url,
    )


def _build_zh_invite_email(
    *,
    project_name: str,
    inviter_name: str,
    score_title: str,
    role: MembershipRole,
    invite_url: str,
) -> InviteEmailContent:
    role_label = "可编辑" if role == MembershipRole.EDITOR else "仅查看"
    subject = f"{inviter_name} 邀请你协作《{score_title}》"
    text_body = (
        f"{inviter_name} 邀请你在 {project_name} 中协作乐谱《{score_title}》。\n"
        f"权限：{role_label}\n\n"
        f"点击链接接受邀请：\n{invite_url}\n\n"
        "如果你不认识这次邀请，可以忽略这封邮件。"
    )
    html_body = _build_html(
        project_name=project_name,
        heading=f"{escape(inviter_name)} 邀请你协作",
        body=(
            f"你被邀请在 <strong>{escape(project_name)}</strong> 中协作乐谱 "
            f"<strong>《{escape(score_title)}》</strong>。"
        ),
        meta_label="权限",
        meta_value=role_label,
        button_label="接受邀请",
        invite_url=invite_url,
        footer="如果你不认识这次邀请，可以忽略这封邮件。",
    )
    return InviteEmailContent(subject=subject, text_body=text_body, html_body=html_body)


def _build_en_invite_email(
    *,
    project_name: str,
    inviter_name: str,
    score_title: str,
    role: MembershipRole,
    invite_url: str,
) -> InviteEmailContent:
    role_label = "Can edit" if role == MembershipRole.EDITOR else "View only"
    subject = f"{inviter_name} invited you to collaborate on {score_title}"
    text_body = (
        f"{inviter_name} invited you to collaborate on \"{score_title}\" in {project_name}.\n"
        f"Role: {role_label}\n\n"
        f"Open this link to accept the invite:\n{invite_url}\n\n"
        "If you were not expecting this invitation, you can ignore this email."
    )
    html_body = _build_html(
        project_name=project_name,
        heading=f"{escape(inviter_name)} invited you to collaborate",
        body=(
            f"You were invited to collaborate on <strong>{escape(score_title)}</strong> "
            f"in <strong>{escape(project_name)}</strong>."
        ),
        meta_label="Role",
        meta_value=role_label,
        button_label="Accept invite",
        invite_url=invite_url,
        footer="If you were not expecting this invitation, you can ignore this email.",
    )
    return InviteEmailContent(subject=subject, text_body=text_body, html_body=html_body)


def _build_html(
    *,
    project_name: str,
    heading: str,
    body: str,
    meta_label: str,
    meta_value: str,
    button_label: str,
    invite_url: str,
    footer: str,
) -> str:
    escaped_url = escape(invite_url, quote=True)
    return f"""<!doctype html>
<html>
  <body style="margin:0;background:#f6f7fb;color:#111827;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f7fb;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:18px;padding:32px;">
            <tr>
              <td>
                <div style="font-size:14px;font-weight:700;color:#ff6b1a;margin-bottom:16px;">{escape(project_name)}</div>
                <h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#111827;">{heading}</h1>
                <p style="margin:0 0 20px;font-size:16px;line-height:1.6;color:#374151;">{body}</p>
                <div style="margin:0 0 24px;padding:14px 16px;border:1px solid #e5e7eb;border-radius:12px;background:#fafafa;">
                  <span style="color:#6b7280;">{escape(meta_label)}：</span>
                  <strong style="color:#111827;">{escape(meta_value)}</strong>
                </div>
                <a href="{escaped_url}" style="display:inline-block;background:#ff6b1a;color:#ffffff;text-decoration:none;font-weight:700;border-radius:999px;padding:13px 22px;">{escape(button_label)}</a>
                <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#6b7280;">{escape(footer)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>"""
