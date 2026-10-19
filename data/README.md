# data/ – tầng dữ liệu OTT

| File | Vai trò |
|---|---|
| [DATABASE_DESIGN.md](DATABASE_DESIGN.md) | Thiết kế database, ER, RLS |
| [supabase/migrations/0001_schema.sql](supabase/migrations/0001_schema.sql) | Schema Postgres cho Supabase |
| [SUPABASE_SETUP.md](SUPABASE_SETUP.md) | Cấu hình Supabase từng bước |
| [CLOUDFLARE_TUNNEL.md](CLOUDFLARE_TUNNEL.md) | Cấu hình máy local làm file server |
| `auth_service.py` | Đăng ký / đăng nhập / đăng xuất / refresh (Supabase Auth), Flask blueprint `/auth/*` |
| `supabase_client.py` | Client Auth + PostgREST (chỉ dùng thư viện chuẩn) |
| `sync.py` | Đồng bộ `ott.db` → Supabase, xuất replay ra file |
| `replay_store.py` | Lưu/đọc replay gzip trong `data/storage/` |
| `storage_server.py` | Phục vụ replay (kiểm quyền bằng JWT + RLS) |
| `manage.py` | CLI tạo/import tài khoản, đổi trạng thái |

## Luồng
1. Thí sinh `POST /auth/register` (hoặc BTC `manage.py import-users`) → `POST /auth/login` → nhận `access_token`.
2. Gọi API cũ (`/submit`, `/me`, `/leaderboard`, `/replays`) với `Authorization: Bearer <token>` (header `X-Token` cũ vẫn dùng được).
3. BTC `entry-close` / `close` / `grade` → `OTT_SUPABASE_SYNC=1` tự đẩy kết quả nhẹ lên Supabase và ghi replay ra `data/storage/`.
4. Thí sinh xem BXH (`get_group_leaderboard`), xem replay qua `files.<domain>/replays/<match_id>`.

`ott.db` (SQLite) vẫn là nơi engine ghi điểm khi chấm; Supabase là nơi lưu tài khoản và dữ liệu hiển thị.

## Test
```bash
.venv/bin/python -m unittest data.tests.test_data_layer -v
```
