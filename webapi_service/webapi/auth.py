from datetime import datetime, timedelta, timezone

from .errors import APIError, missing
from .schemas import User, Session
from .security import DUMMY_HASH, digest, hasher, token_pair, verify_password

USER_COLUMNS = ', '.join(User.model_fields)
SESSION_COLUMNS = ', '.join(Session.model_fields)


class AuthService:
    def __init__(self, repo, settings, notifications):
        self.repo, self.settings, self.notifications = repo, settings, notifications

    def issue_action(self, user, purpose):
        raw, hashed = token_pair()
        self.repo.conn.execute('INSERT INTO auth.action_token '
                               '(user_id, purpose, token_hash, expires_at) VALUES (%s,%s,%s,%s)',
                               (user['id'], purpose, hashed, datetime.now(timezone.utc) +
                                timedelta(minutes=self.settings.token_minutes)))
        self.notifications.send_token(user['email'], purpose, raw)

    def register(self, data):
        self.notifications.require_available()
        encoded = hasher.hash(data.password.get_secret_value())
        user = self.repo.one(f'INSERT INTO auth.user_account '
                             '(email, display_name, password_hash) VALUES (%s,%s,%s) '
                             f'ON CONFLICT (lower(email)) DO NOTHING RETURNING {USER_COLUMNS}',
                             (str(data.email).lower(), data.display_name, encoded))
        if user:
            self.issue_action(user, 'verify_email')
            self.repo.audit(user, 'register', 'user_account', user['id'])
        return {'message': 'Request accepted'}

    def login(self, data):
        user = self.repo.one('SELECT * FROM auth.user_account WHERE lower(email) = lower(%s) '
                             'FOR UPDATE', (str(data.email),))
        valid = verify_password(user['password_hash'] if user else DUMMY_HASH,
                                data.password.get_secret_value())
        if not user or not valid:
            raise APIError(401, 'invalid_credentials', 'Invalid email or password')
        self.check_active(user)
        if hasher.check_needs_rehash(user['password_hash']):
            self.repo.conn.execute('UPDATE auth.user_account SET password_hash=%s, updated_at=now() '
                                   'WHERE id=%s', (hasher.hash(data.password.get_secret_value()), user['id']))
        raw, hashed = token_pair()
        session = self.repo.one('INSERT INTO auth.user_session (user_id, token_hash, expires_at) '
                                'VALUES (%s,%s,%s) RETURNING expires_at',
                                (user['id'], hashed, datetime.now(timezone.utc) +
                                 timedelta(hours=self.settings.session_hours)))
        return {'access_token': raw, 'expires_at': session['expires_at'],
                'user': {k: user[k] for k in USER_COLUMNS.split(', ')}}

    @staticmethod
    def check_active(user):
        if user['status'] != 'active' or user['email_confirmed_at'] is None:
            raise APIError(403, 'account_unavailable', 'Account is disabled or email is unconfirmed')

    def authenticate(self, token):
        if not token or len(token) > 128:
            raise APIError(401, 'invalid_session', 'Valid bearer session required')
        identity = self.repo.one('SELECT user_id,id FROM auth.user_session WHERE token_hash=%s', (digest(token),))
        if not identity:
            raise APIError(401, 'invalid_session', 'Valid bearer session required')
        user = self.repo.one('SELECT * FROM auth.user_account WHERE id=%s FOR UPDATE', (identity['user_id'],))
        session = self.repo.one('SELECT id FROM auth.user_session WHERE id=%s '
                                'AND revoked_at IS NULL AND expires_at > now() FOR UPDATE', (identity['id'],))
        if not user or not session:
            raise APIError(401, 'invalid_session', 'Valid bearer session required')
        self.check_active(user)
        # Never let the hash propagate to a response or audit.
        return {**{k: user[k] for k in USER_COLUMNS.split(', ')}, 'session_id': session['id']}

    def request_action(self, email, purpose):
        self.notifications.require_available()
        user = self.repo.one('SELECT id,email,status,email_confirmed_at FROM auth.user_account '
                             'WHERE lower(email)=lower(%s) FOR UPDATE', (str(email),))
        if user and user['status'] != 'disabled':
            allowed = (purpose == 'verify_email' and user['email_confirmed_at'] is None
                       or purpose == 'reset_password' and user['status'] == 'active')
            if allowed:
                try:
                    # Roll back a token whose notification failed, but keep the same public
                    # response for known and unknown addresses, including SMTP outages.
                    with self.repo.conn.transaction():
                        self.issue_action(user, purpose)
                except APIError as exc:
                    if exc.code != 'notifications_unavailable':
                        raise
        return {'message': 'Request accepted'}

    def consume_action(self, raw, purpose, password=None):
        # Acquire account before token everywhere to avoid reset/login/confirmation deadlocks.
        token = self.repo.one('SELECT user_id FROM auth.action_token WHERE token_hash=%s AND purpose=%s',
                              (digest(raw), purpose))
        if not token:
            raise APIError(400, 'invalid_action_token', 'Invalid or expired action token')
        user = self.repo.one('SELECT * FROM auth.user_account WHERE id=%s FOR UPDATE',
                             (token['user_id'],))
        token = self.repo.one('SELECT id FROM auth.action_token WHERE token_hash=%s AND purpose=%s '
                              'AND used_at IS NULL AND expires_at > now() FOR UPDATE', (digest(raw), purpose))
        if not token or user['status'] == 'disabled':
            raise APIError(400, 'invalid_action_token', 'Invalid or expired action token')
        if purpose == 'verify_email':
            self.repo.conn.execute("UPDATE auth.user_account SET status='active', "
                                   'email_confirmed_at=coalesce(email_confirmed_at,now()), updated_at=now() '
                                   'WHERE id=%s', (user['id'],))
        else:
            self.check_active(user)
            self.repo.conn.execute('UPDATE auth.user_account SET password_hash=%s, updated_at=now() '
                                   'WHERE id=%s', (hasher.hash(password.get_secret_value()), user['id']))
            self.repo.conn.execute('UPDATE auth.user_session SET revoked_at=now() '
                                   'WHERE user_id=%s AND revoked_at IS NULL', (user['id'],))
        # Invalidate siblings of the same purpose as well as the token used.
        self.repo.conn.execute('UPDATE auth.action_token SET used_at=now() WHERE user_id=%s '
                               'AND purpose=%s AND used_at IS NULL', (user['id'], purpose))
        self.repo.audit(user, purpose, 'user_account', user['id'])
        return {'message': 'Request accepted'}

    def profile(self, user, data):
        result = self.repo.one(f'UPDATE auth.user_account SET display_name=%s, updated_at=now() '
                               f'WHERE id=%s RETURNING {USER_COLUMNS}', (data.display_name, user['id']))
        self.repo.audit(user, 'update_profile', 'user_account', user['id'], ['display_name'])
        return result

    def sessions(self, user, limit, offset):
        total = self.repo.one('SELECT count(*) AS total FROM auth.user_session WHERE user_id=%s',
                              (user['id'],))['total']
        items = self.repo.all(f'SELECT {SESSION_COLUMNS} FROM auth.user_session WHERE user_id=%s '
                              'ORDER BY id DESC LIMIT %s OFFSET %s', (user['id'], limit, offset))
        return dict(items=items, total=total, limit=limit, offset=offset)

    def revoke(self, user, session_id):
        row = self.repo.one('UPDATE auth.user_session SET revoked_at=coalesce(revoked_at,now()) '
                            'WHERE id=%s AND user_id=%s RETURNING id', (session_id, user['id']))
        if not row:
            missing()
        self.repo.audit(user, 'revoke_session', 'user_session', session_id)
