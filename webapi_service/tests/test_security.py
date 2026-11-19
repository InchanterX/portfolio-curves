import pytest

from webapi.errors import APIError
from webapi.security import RateLimiter, digest, hasher, token_pair, verify_password


def test_password_hashes_are_salted_and_verified():
    first, second = hasher.hash('secure password 123'), hasher.hash('secure password 123')
    assert first != second
    assert 'secure password' not in first
    assert verify_password(first, 'secure password 123')
    assert not verify_password(first, 'wrong password')


@pytest.mark.parametrize('encoded', ['', 'plain password', 'scrypt$1$1$1$a$b',
                                      'scrypt$32768$8$3$' + 'z'*32 + '$' + '0'*128])
def test_malformed_hash_is_rejected(encoded):
    assert not verify_password(encoded, 'password')


def test_tokens_are_random_and_only_digest_is_persisted():
    raw, hashed = token_pair()
    assert len(raw) >= 40 and len(hashed) == 64
    assert digest(raw) == hashed and raw != hashed
    assert token_pair()[0] != raw


def test_limiter_blocks_and_expires(monkeypatch):
    clock = [1.0]
    monkeypatch.setattr('webapi.security.time.monotonic', lambda: clock[0])
    limiter = RateLimiter(2)
    limiter.check('client')
    limiter.check('client')
    with pytest.raises(APIError) as caught:
        limiter.check('client')
    assert caught.value.status == 429
    clock[0] = 62
    limiter.check('client')


def test_limiter_bounds_memory_without_evicting_blocked_clients():
    limiter = RateLimiter(2, max_keys=1)
    limiter.check('first')
    with pytest.raises(APIError):
        limiter.check('second')
    assert len(limiter.entries) == 1
