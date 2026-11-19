from dataclasses import dataclass, field
import os


@dataclass(frozen=True)
class Settings:
    database_dsn: str = field(default='', repr=False)
    session_hours: int = 24
    token_minutes: int = 30
    auth_requests_per_minute: int = 10
    smtp_host: str = ''
    smtp_port: int = 587
    smtp_user: str = ''
    smtp_password: str = field(default='', repr=False)
    smtp_sender: str = ''
    storage_adapter: str = 'disabled'

    @classmethod
    def from_env(cls):
        return cls(
            database_dsn=os.getenv('DATABASE_DSN', ''),
            session_hours=int(os.getenv('SESSION_HOURS', '24')),
            token_minutes=int(os.getenv('ACTION_TOKEN_MINUTES', '30')),
            auth_requests_per_minute=int(os.getenv('AUTH_REQUESTS_PER_MINUTE', '10')),
            smtp_host=os.getenv('SMTP_HOST', ''),
            smtp_port=int(os.getenv('SMTP_PORT', '587')),
            smtp_user=os.getenv('SMTP_USER', ''),
            smtp_password=os.getenv('SMTP_PASSWORD', ''),
            smtp_sender=os.getenv('SMTP_SENDER', ''),
            storage_adapter=os.getenv('STORAGE_ADAPTER', 'disabled'),
        )

    def __post_init__(self):
        if min(self.session_hours, self.token_minutes, self.auth_requests_per_minute) <= 0:
            raise ValueError('Timeouts and rate limits must be positive')
        if self.storage_adapter != 'disabled':
            raise ValueError('Storage contract is not configured; STORAGE_ADAPTER must be disabled')
