"""
finals/db.py
------------
Kết nối PostgreSQL cho vòng chung kết.
Đọc cấu hình từ biến môi trường (hoặc file .env).

Biến môi trường cần thiết:
  FINALS_DB_HOST     (mặc định: localhost)
  FINALS_DB_PORT     (mặc định: 5432)
  FINALS_DB_NAME     (mặc định: finals)
  FINALS_DB_USER     (mặc định: postgres)
  FINALS_DB_PASSWORD (bắt buộc)
"""
import logging
import os
import time

import psycopg2
import psycopg2.extras
import psycopg2.pool

logger = logging.getLogger("finals.db")

# ---------------------------------------------------------------------------
# Cấu hình kết nối
# ---------------------------------------------------------------------------
_DSN = dict(
    host=os.environ.get("FINALS_DB_HOST", "localhost"),
    port=int(os.environ.get("FINALS_DB_PORT", 5432)),
    dbname=os.environ.get("FINALS_DB_NAME", "finals"),
    user=os.environ.get("FINALS_DB_USER", "postgres"),
    password=os.environ.get("FINALS_DB_PASSWORD", ""),
    connect_timeout=10,
)

_pool: psycopg2.pool.ThreadedConnectionPool | None = None


def init_pool(minconn: int = 2, maxconn: int = 20) -> None:
    """Khởi tạo connection pool. Gọi 1 lần khi app khởi động."""
    global _pool
    logger.info(
        "[DB] Kết nối PostgreSQL %s:%s/%s user=%s",
        _DSN["host"], _DSN["port"], _DSN["dbname"], _DSN["user"],
    )
    _pool = psycopg2.pool.ThreadedConnectionPool(minconn, maxconn, **_DSN)
    logger.info("[DB] Pool khởi tạo thành công (min=%d max=%d)", minconn, maxconn)


def get_conn():
    """Lấy connection từ pool (thread-safe)."""
    if _pool is None:
        raise RuntimeError("DB pool chưa được khởi tạo. Gọi db.init_pool() trước.")
    return _pool.getconn()


def put_conn(conn) -> None:
    """Trả connection về pool."""
    if _pool is not None:
        _pool.putconn(conn)


class _Conn:
    """Context-manager: tự trả connection về pool sau khi dùng."""
    def __enter__(self):
        self._conn = get_conn()
        return self._conn

    def __exit__(self, exc_type, *_):
        if exc_type:
            try:
                self._conn.rollback()
            except Exception:
                pass
        put_conn(self._conn)


def conn() -> _Conn:
    return _Conn()


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------
SCHEMA = """
-- Bảng sinh viên tham gia chung kết
CREATE TABLE IF NOT EXISTS contestants (
    id          SERIAL PRIMARY KEY,
    username    TEXT UNIQUE NOT NULL,
    password    TEXT NOT NULL,                -- bcrypt hash
    display_name TEXT NOT NULL,
    student_id  TEXT UNIQUE,                  -- MSSV, tuỳ chọn
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- Phiên đăng nhập (JWT-less, dùng session token)
CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT PRIMARY KEY,
    username    TEXT NOT NULL REFERENCES contestants(username) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL
);

-- Danh sách cặp đấu chung kết
CREATE TABLE IF NOT EXISTS matches (
    id          SERIAL PRIMARY KEY,
    request_id  TEXT UNIQUE NOT NULL,         -- UUID gửi từ client để idempotent
    player_a    TEXT NOT NULL REFERENCES contestants(username),
    player_b    TEXT NOT NULL REFERENCES contestants(username),
    status      TEXT NOT NULL DEFAULT 'pending',  -- pending | running | done | failed
    score_a     INT,
    score_b     INT,
    winner      TEXT,
    created_at  TIMESTAMPTZ DEFAULT now(),
    started_at  TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    error_msg   TEXT,
    replay      JSONB
);

-- Bảng điểm tổng (tích luỹ)
CREATE TABLE IF NOT EXISTS standings (
    username    TEXT PRIMARY KEY REFERENCES contestants(username),
    wins        INT DEFAULT 0,
    losses      INT DEFAULT 0,
    draws       INT DEFAULT 0,
    points      INT DEFAULT 0,
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Index
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);
CREATE INDEX IF NOT EXISTS idx_sessions_username ON sessions(username);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
"""


def migrate() -> None:
    """Chạy schema DDL (idempotent — an toàn khi gọi nhiều lần)."""
    with conn() as c:
        with c.cursor() as cur:
            cur.execute(SCHEMA)
        c.commit()
    logger.info("[DB] Schema migration hoàn tất.")


# ---------------------------------------------------------------------------
# Helper query
# ---------------------------------------------------------------------------
def fetchone(sql: str, params=()) -> dict | None:
    with conn() as c:
        with c.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            row = cur.fetchone()
    return dict(row) if row else None


def fetchall(sql: str, params=()) -> list[dict]:
    with conn() as c:
        with c.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()
    return [dict(r) for r in rows]


def execute(sql: str, params=()) -> None:
    with conn() as c:
        with c.cursor() as cur:
            cur.execute(sql, params)
        c.commit()


def executemany(sql: str, rows: list) -> None:
    with conn() as c:
        with c.cursor() as cur:
            psycopg2.extras.execute_batch(cur, sql, rows)
        c.commit()
