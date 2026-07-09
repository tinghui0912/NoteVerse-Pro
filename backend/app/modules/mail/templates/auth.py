from __future__ import annotations

from app.modules.mail.templates.base import MailContent, build_action_email, build_notice_email


def build_email_verification_email(
    *,
    locale: str,
    project_name: str,
    verification_url: str,
    ttl_seconds: int,
) -> MailContent:
    minutes = max(1, ttl_seconds // 60)
    if locale == "en":
        return build_action_email(
            project_name=project_name,
            subject=f"Verify your {project_name} email",
            heading="Verify your email address",
            intro=f"Confirm this email address to finish creating your {project_name} account.",
            action_label="Verify email",
            action_url=verification_url,
            expires_label=f"This link expires in {minutes} minutes.",
            footer="If you did not create this account, you can ignore this email.",
        )

    return build_action_email(
        project_name=project_name,
        subject=f"验证你的 {project_name} 邮箱",
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
) -> MailContent:
    minutes = max(1, ttl_seconds // 60)
    if locale == "en":
        return build_action_email(
            project_name=project_name,
            subject=f"Reset your {project_name} password",
            heading="Reset your password",
            intro="Use this secure link to choose a new password for your account.",
            action_label="Reset password",
            action_url=reset_url,
            expires_label=f"This link expires in {minutes} minutes.",
            footer="If you did not request a password reset, you can ignore this email.",
        )

    return build_action_email(
        project_name=project_name,
        subject=f"重置你的 {project_name} 密码",
        heading="重置你的密码",
        intro="请使用这个安全链接为你的账号设置新密码。",
        action_label="重置密码",
        action_url=reset_url,
        expires_label=f"链接将在 {minutes} 分钟后过期。",
        footer="如果这不是你本人操作，请忽略这封邮件。",
    )


def build_password_changed_email(*, locale: str, project_name: str) -> MailContent:
    if locale == "en":
        return build_notice_email(
            project_name=project_name,
            subject=f"Your {project_name} password was changed",
            heading="Your password was changed",
            intro=(
                "The password for your account was just changed. "
                "If this was not you, reset your password immediately."
            ),
        )

    return build_notice_email(
        project_name=project_name,
        subject=f"你的 {project_name} 密码已修改",
        heading="你的密码已修改",
        intro="你的账号密码刚刚被修改。如果这不是你本人操作，请立即重新重置密码。",
    )
