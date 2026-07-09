from __future__ import annotations

from dataclasses import dataclass
from html import escape


@dataclass(frozen=True)
class AuthEmailContent:
    subject: str
    text_body: str
    html_body: str


def build_email_verification_email(
    *,
    locale: str,
    project_name: str,
    verification_url: str,
    ttl_seconds: int,
) -> AuthEmailContent:
    minutes = max(1, ttl_seconds // 60)
    if locale == "en":
        return _build_action_email(
            project_name=project_name,
            subject=f"Verify your {project_name} email",
            eyebrow="Email verification",
            heading="Verify your email address",
            intro=f"Confirm this email address to finish creating your {project_name} account.",
            action_label="Verify email",
            action_url=verification_url,
            expires_label=f"This link expires in {minutes} minutes.",
            footer="If you did not create this account, you can ignore this email.",
        )

    return _build_action_email(
        project_name=project_name,
        subject=f"验证你的 {project_name} 邮箱",
        eyebrow="邮箱验证",
        heading="验证你的邮箱地址",
        intro=f"请确认这个邮箱地址，用于完成你的 {project_name} 账号注册。",
        action_label="验证邮箱",
        action_url=verification_url,
        expires_label=f"链接将在 {minutes} 分钟后过期。",
        footer="如果这不是你本人操作，请忽略这封邮件。",
    )


def build_password_reset_email(
    *,
    locale: str,
    project_name: str,
    reset_url: str,
    ttl_seconds: int,
) -> AuthEmailContent:
    minutes = max(1, ttl_seconds // 60)
    if locale == "en":
        return _build_action_email(
            project_name=project_name,
            subject=f"Reset your {project_name} password",
            eyebrow="Password reset",
            heading="Reset your password",
            intro="Use this secure link to choose a new password for your account.",
            action_label="Reset password",
            action_url=reset_url,
            expires_label=f"This link expires in {minutes} minutes.",
            footer="If you did not request a password reset, you can ignore this email.",
        )

    return _build_action_email(
        project_name=project_name,
        subject=f"重置你的 {project_name} 密码",
        eyebrow="密码重置",
        heading="重置你的密码",
        intro="请使用这个安全链接为你的账号设置新密码。",
        action_label="重置密码",
        action_url=reset_url,
        expires_label=f"链接将在 {minutes} 分钟后过期。",
        footer="如果这不是你本人操作，请忽略这封邮件。",
    )


def build_password_changed_email(*, locale: str, project_name: str) -> AuthEmailContent:
    if locale == "en":
        return _build_notice_email(
            project_name=project_name,
            subject=f"Your {project_name} password was changed",
            eyebrow="Security notice",
            heading="Your password was changed",
            intro=(
                "The password for your account was just changed. "
                "If this was not you, reset your password immediately."
            ),
        )

    return _build_notice_email(
        project_name=project_name,
        subject=f"你的 {project_name} 密码已修改",
        eyebrow="安全通知",
        heading="你的密码已修改",
        intro="你的账号密码刚刚被修改。如果这不是你本人操作，请立即重新重置密码。",
    )


def _build_action_email(
    *,
    project_name: str,
    subject: str,
    eyebrow: str,
    heading: str,
    intro: str,
    action_label: str,
    action_url: str,
    expires_label: str,
    footer: str,
) -> AuthEmailContent:
    text_body = (
        f"{heading}\n\n"
        f"{intro}\n\n"
        f"{action_label}: {action_url}\n\n"
        f"{expires_label}\n"
        f"{footer}"
    )
    html_body = _build_html(
        project_name=project_name,
        eyebrow=eyebrow,
        heading=heading,
        intro=intro,
        action_label=action_label,
        action_url=action_url,
        note=expires_label,
        footer=footer,
    )
    return AuthEmailContent(subject=subject, text_body=text_body, html_body=html_body)


def _build_notice_email(
    *,
    project_name: str,
    subject: str,
    eyebrow: str,
    heading: str,
    intro: str,
) -> AuthEmailContent:
    text_body = f"{heading}\n\n{intro}"
    html_body = _build_html(
        project_name=project_name,
        eyebrow=eyebrow,
        heading=heading,
        intro=intro,
    )
    return AuthEmailContent(subject=subject, text_body=text_body, html_body=html_body)


def _build_html(
    *,
    project_name: str,
    eyebrow: str,
    heading: str,
    intro: str,
    action_label: str | None = None,
    action_url: str | None = None,
    note: str | None = None,
    footer: str | None = None,
) -> str:
    action_html = ""
    if action_label and action_url:
        escaped_url = escape(action_url, quote=True)
        action_html = f"""
                <div style="margin:0 0 24px;">
                  <a href="{escaped_url}" style="display:inline-block;background:#ff6b1a;color:#ffffff;text-decoration:none;border-radius:10px;padding:12px 18px;font-size:15px;font-weight:700;">{escape(action_label)}</a>
                </div>
                <p style="margin:0 0 24px;font-size:12px;line-height:1.6;color:#6b7280;word-break:break-all;">{escaped_url}</p>"""

    note_html = (
        f'<p style="margin:0 0 24px;font-size:14px;color:#6b7280;">{escape(note)}</p>'
        if note
        else ""
    )
    footer_html = (
        f'<p style="margin:0;font-size:13px;line-height:1.6;color:#6b7280;">{escape(footer)}</p>'
        if footer
        else ""
    )
    return f"""<!doctype html>
<html>
  <body style="margin:0;background:#f6f7fb;color:#111827;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f7fb;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border:1px solid #e5e7eb;border-radius:18px;padding:32px;">
            <tr>
              <td>
                <div style="font-size:14px;font-weight:700;color:#ff6b1a;margin-bottom:16px;">{escape(project_name)}</div>
                <div style="font-size:13px;color:#6b7280;margin-bottom:8px;">{escape(eyebrow)}</div>
                <h1 style="margin:0 0 14px;font-size:24px;line-height:1.25;color:#111827;">{escape(heading)}</h1>
                <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#374151;">{escape(intro)}</p>{action_html}
                {note_html}
                {footer_html}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>"""
