"""Local learning mode: credentials live in Python memory, tournament data in ott.db.

This module implements the same small interface as auth_service (Supabase), so the
existing session, authorization and tournament routes can be reused.
"""
import os
import secrets
import threading
import time

from werkzeug.security import check_password_hash, generate_password_hash

from .auth_service import validate_credentials

_lock = threading.RLock()
_accounts = {}
_sessions = {}
_refresh_tokens = {}
_dummy_hash = generate_password_hash(secrets.token_urlsafe(24))
TOKEN_TTL = 3600


def _profile(account):
    return {key: account[key] for key in ("id", "username", "role", "status")}


def ensure_local_user(username):
    import tournament as T
    with _lock:
        if not T.q("select 1 from users where name=?", (username,)):
            T.register(username)


def create_account(username, password, admin=False, ip=None, ua=None):
    validate_credentials(username, password)
    hashed = generate_password_hash(password)
    with _lock:
        if username.lower() in _accounts:
            raise ValueError("Tên tài khoản đã tồn tại")
        # Existing legacy tournament names must not be claimable by a new signup.
        import tournament as T
        if T.q("select 1 from users where lower(name)=lower(?)", (username,)):
            raise ValueError("Tên thi đấu đã tồn tại. Hãy dùng tên khác.")
        ensure_local_user(username)
        _accounts[username.lower()] = {
            "id": secrets.token_hex(16), "username": username,
            "role": "admin" if admin else "player", "status": "active",
            "password_hash": hashed,
        }


def _issue(account):
    at, rt = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    expires = time.time() + TOKEN_TTL
    _sessions[at] = (account["username"].lower(), expires, rt)
    _refresh_tokens[rt] = at
    return {"access_token": at, "refresh_token": rt, "expires_in": TOKEN_TTL,
            "user": _profile(account)}


def login(username, password, ip=None, ua=None):
    if not isinstance(username, str) or not isinstance(password, str) or len(password) > 72:
        raise PermissionError("Tên đăng nhập hoặc mật khẩu không đúng")
    with _lock:
        account = _accounts.get(username.lower())
        valid = check_password_hash(account["password_hash"] if account else _dummy_hash, password)
        if not account or not valid:
            raise PermissionError("Tên đăng nhập hoặc mật khẩu không đúng")
        if account["role"] != "admin":
            ensure_local_user(account["username"])
        return _issue(account)


def verify_token(access_token):
    with _lock:
        stored = _sessions.get(access_token)
        if not stored or stored[1] < time.time():
            raise PermissionError("Phiên đăng nhập hết hạn")
        return _profile(_accounts[stored[0]])


def refresh(refresh_token):
    with _lock:
        at = _refresh_tokens.get(refresh_token)
        stored = _sessions.get(at)
        if not stored:
            raise PermissionError("Phiên đăng nhập hết hạn")
        account = _accounts[stored[0]]
        logout(at)
        return _issue(account)


def logout(access_token, ip=None, ua=None):
    with _lock:
        stored = _sessions.pop(access_token, None)
        if stored:
            _refresh_tokens.pop(stored[2], None)


def _seed(username, password, role):
    _accounts[username.lower()] = {
        "id": secrets.token_hex(16), "username": username, "role": role,
        "status": "active", "password_hash": generate_password_hash(password),
    }


_seed("demo", os.environ.get("OTT_DEMO_PASSWORD", "Demo@123456"), "player")
if os.environ.get("ADMIN_PASSWORD"):
    _seed("admin_local", os.environ["ADMIN_PASSWORD"], "admin")
