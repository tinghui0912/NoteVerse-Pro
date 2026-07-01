from __future__ import annotations

from dataclasses import dataclass
from html import escape


@dataclass(frozen=True)
class VerificationEmailContent:
    subject: str
    text_body: str
    html_body: str


def build_verification_email(
    *,
    locale: str,
    project_name: str,
    code: str,
    purpose: str,
    ttl_seconds: int,
) -> VerificationEmailContent:
    if locale == "en":
        return _build_en_email(
            project_name=project_name,
            code=code,
            purpose=purpose,
            ttl_seconds=ttl_seconds,
        )
    return _build_zh_email(
        project_name=project_name,
        code=code,
        purpose=purpose,
        ttl_seconds=ttl_seconds,
    )


def _build_zh_email(
    *,
    project_name: str,
    code: str,
    purpose: str,
    ttl_seconds: int,
) -> VerificationEmailContent:
    is_reset = purpose == "password_reset"
    title = "重置密码验证码" if is_reset else "注册验证码"
    subject = f"{project_name} {title}"
    action = "重置密码" if is_reset else "完成注册"
    minutes = max(1, ttl_seconds // 60)
    text_body = (
        f"你的 {project_name} {title}是：{code}\n"
        f"验证码将在 {minutes} 分钟后过期。\n"
        f"请在页面中输入该验证码以{action}。\n"
        "如果这不是你本人操作，请忽略这封邮件。"
    )
    html_body = _build_html(
        project_name=project_name,
        eyebrow=title,
        heading=f"使用验证码{action}",
        intro=f"请在 {escape(project_name)} 页面中输入以下 6 位验证码。",
        code=code,
        expires_label=f"{minutes} 分钟后过期",
        footer="如果这不是你本人操作，请忽略这封邮件。",
    )
    return VerificationEmailContent(subject=subject, text_body=text_body, html_body=html_body)


def _build_en_email(
    *,
    project_name: str,
    code: str,
    purpose: str,
    ttl_seconds: int,
) -> VerificationEmailContent:
    is_reset = purpose == "password_reset"
    title = "Password Reset Code" if is_reset else "Registration Code"
    subject = f"{project_name} {title}"
    action = "reset your password" if is_reset else "finish signing up"
    minutes = max(1, ttl_seconds // 60)
    text_body = (
        f"Your {project_name} {title.lower()} is: {code}\n"
        f"This code will expire in {minutes} minutes.\n"
        f"Enter this code to {action}.\n"
        "If you did not request this, you can ignore this email."
    )
    html_body = _build_html(
        project_name=project_name,
        eyebrow=title,
        heading=f"Use this code to {action}",
        intro=f"Enter this 6-digit code in {escape(project_name)}.",
        code=code,
        expires_label=f"Expires in {minutes} minutes",
        footer="If you did not request this, you can ignore this email.",
    )
    return VerificationEmailContent(subject=subject, text_body=text_body, html_body=html_body)


def _build_html(
    *,
    project_name: str,
    eyebrow: str,
    heading: str,
    intro: str,
    code: str,
    expires_label: str,
    footer: str,
) -> str:
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
                <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#374151;">{intro}</p>
                <div style="margin:0 0 16px;padding:20px;border:1px solid #fed7aa;border-radius:14px;background:#fff7ed;text-align:center;">
                  <div style="font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono',monospace;font-size:36px;letter-spacing:8px;font-weight:800;color:#111827;">{escape(code)}</div>
                </div>
                <p style="margin:0 0 24px;font-size:14px;color:#6b7280;text-align:center;">{escape(expires_label)}</p>
                <p style="margin:0;font-size:13px;line-height:1.6;color:#6b7280;">{escape(footer)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>"""
