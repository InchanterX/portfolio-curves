from collections import OrderedDict
from hashlib import sha256
import hashlib
import hmac
import secrets
import threading
import time

from .errors import APIError


class PasswordHasher:
    """Versioned scrypt hashes. Parameters are fixed and verified before expensive work."""
    def hash(self, password):
        salt = secrets.token_bytes(16)
        key = hashlib.scrypt(password.encode(), salt=salt, n=32768, r=8, p=3, maxmem=67108864)
        return f'scrypt$32768$8$3${salt.hex()}${key.hex()}'

    def verify(self, encoded, password):
        try:
            algorithm, n, r, p, salt, expected = encoded.split('$')
            if (algorithm, n, r, p) != ('scrypt', '32768', '8', '3'):
                return False
            if len(salt) != 32 or len(expected) != 128:
                return False
            actual = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt),
                                    n=32768, r=8, p=3, maxmem=67108864)
            return hmac.compare_digest(actual, bytes.fromhex(expected))
        except (ValueError, TypeError):
            return False

    def check_needs_rehash(self, encoded):
        return not encoded.startswith('scrypt$32768$8$3$')


hasher = PasswordHasher()
DUMMY_HASH = hasher.hash(secrets.token_urlsafe(32))


def verify_password(encoded, password):
    return hasher.verify(encoded, password)


def token_pair():
    raw = secrets.token_urlsafe(32)
    return raw, digest(raw)


def digest(raw):
    return sha256(raw.encode()).hexdigest()


class RateLimiter:
    """Bounded, thread-safe, single-process limiter. Shared gateway required for replicas."""
    def __init__(self, limit, max_keys=10000):
        self.limit, self.max_keys = limit, max_keys
        self.entries = OrderedDict()
        self.lock = threading.Lock()

    def check(self, key):
        now = time.monotonic()
        with self.lock:
            # Expiry order is insertion order; windows do not slide on each request.
            while self.entries and next(iter(self.entries.values()))[0] <= now:
                self.entries.popitem(last=False)
            expiry, count = self.entries.get(key, (now + 60, 0))
            if count >= self.limit or (key not in self.entries and len(self.entries) >= self.max_keys):
                raise APIError(429, 'rate_limited', 'Too many requests; retry later')
            self.entries[key] = (expiry, count + 1)
