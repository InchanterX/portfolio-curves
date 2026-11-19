"""External integration boundaries. No implicit storage or email simulation."""
from email.message import EmailMessage
from typing import Protocol
import smtplib
import ssl
import logging

from .errors import APIError


class Notifications(Protocol):
    def require_available(self) -> None: ...
    def send_token(self, email: str, purpose: str, token: str) -> None: ...


class SMTPNotifications:
    def __init__(self, settings):
        self.settings = settings

    def require_available(self):
        if not self.settings.smtp_host or not self.settings.smtp_sender:
            raise APIError(503, 'notifications_unavailable', 'Email delivery is not configured')

    def send_token(self, email, purpose, token):
        self.require_available()
        message = EmailMessage()
        message['From'] = self.settings.smtp_sender
        message['To'] = email
        message['Subject'] = 'Curves: ' + purpose
        message.set_content(f'Action: {purpose}\nOne-time token: {token}\n'
                            f'Expires in {self.settings.token_minutes} minutes.')
        try:
            with smtplib.SMTP(self.settings.smtp_host, self.settings.smtp_port, timeout=10) as smtp:
                smtp.starttls(context=ssl.create_default_context())
                if self.settings.smtp_user:
                    smtp.login(self.settings.smtp_user, self.settings.smtp_password)
                smtp.send_message(message)
        except (OSError, smtplib.SMTPException):
            logging.getLogger(__name__).warning('SMTP action delivery failed')
            raise APIError(503, 'notifications_unavailable', 'Email delivery failed') from None


class ObjectStorage(Protocol):
    """Marker port; access and object identity contract must be agreed before adding operations."""
    def require_available(self) -> None: ...


class DisabledObjectStorage:
    def require_available(self):
        raise APIError(503, 'storage_unavailable', 'Object storage contract is not configured')
