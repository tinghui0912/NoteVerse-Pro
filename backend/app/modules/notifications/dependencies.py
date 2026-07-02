from app.modules.notifications.service import NotificationService


def get_notification_service() -> NotificationService:
    return NotificationService()
