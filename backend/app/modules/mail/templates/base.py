from __future__ import annotations

from dataclasses import dataclass
from html import escape


@dataclass(frozen=True)
class MailContent:
    subject: str
    text_body: str
    html_body: str


def build_action_email(
    *,
    project_name: str,
    subject: str,
    heading: str,
    intro: str,
    action_label: str,
    action_url: str,
    expires_label: str,
    footer: str,
) -> MailContent:
    text_body = (
        f"{heading}\n\n"
        f"{intro}\n\n"
        f"{action_label}: {action_url}\n\n"
        f"{expires_label}\n"
        f"{footer}"
    )
    html_body = build_html_shell(
        project_name=project_name,
        heading=escape(heading),
        body_html=escape(intro),
        action_label=action_label,
        action_url=action_url,
        note=expires_label,
        footer=footer,
    )
    return MailContent(subject=subject, text_body=text_body, html_body=html_body)


def build_notice_email(
    *,
    project_name: str,
    subject: str,
    heading: str,
    intro: str,
) -> MailContent:
    text_body = f"{heading}\n\n{intro}"
    html_body = build_html_shell(
        project_name=project_name,
        heading=escape(heading),
        body_html=escape(intro),
    )
    return MailContent(subject=subject, text_body=text_body, html_body=html_body)


def build_html_shell(
    *,
    project_name: str,
    heading: str,
    body_html: str,
    action_label: str | None = None,
    action_url: str | None = None,
    note: str | None = None,
    footer: str | None = None,
    extra_html: str = "",
    action_border_radius: str = "10px",
    max_width: int = 520,
) -> str:
    action_html = ""
    if action_label and action_url:
        escaped_url = escape(action_url, quote=True)
        action_html = f"""
                <div style="margin:0 0 24px;">
                  <a href="{escaped_url}" style="display:inline-block;background:#ff6b1a;color:#ffffff;text-decoration:none;border-radius:{escape(action_border_radius, quote=True)};padding:12px 18px;font-size:15px;font-weight:700;">{escape(action_label)}</a>
                </div>"""

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
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:{max_width}px;background:#ffffff;border:1px solid #e5e7eb;border-radius:18px;padding:32px;">
            <tr>
              <td>
                <div style="font-size:14px;font-weight:700;color:#ff6b1a;margin-bottom:16px;">{escape(project_name)}</div>
                <h1 style="margin:0 0 14px;font-size:24px;line-height:1.25;color:#111827;">{heading}</h1>
                <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#374151;">{body_html}</p>{extra_html}{action_html}
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
