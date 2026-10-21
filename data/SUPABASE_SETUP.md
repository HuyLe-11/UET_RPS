# Cấu hình Supabase

> **Trạng thái v0 (2026-10-21):** phần hướng dẫn đồng bộ SQLite ở các mục dưới là luồng giải đấu cũ. Với demo hiện tại, chạy lần lượt toàn bộ migration `0001`–`0004`; dashboard và replay mới dùng Supabase trực tiếp, còn module chấm cần service role để ghi job/replay. Quy trình chuyển `grade_day` và lịch sử SQLite chưa hoàn tất; xem `../SCORING_MIGRATION_HANDOFF.md`.

## 1. Tạo project
1. Vào https://supabase.com → **New project** (chọn region gần VN: Singapore).
2. Lưu **Database password**. Đợi project khởi tạo xong.

## 2. Chạy schema
**Dashboard → SQL Editor → New query**, chạy tuần tự từng migration:
`0001_schema.sql` → `0002_scoring_jobs.sql` → `0003_immediate_scoring_and_admin_phases.sql` → `0004_replay_storage_and_web_api.sql`.
Không chạy `0004` trước các migration tạo `matches` và `scoring_jobs`.

## 3. Cấu hình Auth
**Authentication → Providers → Email**:
- Bật **Email** provider.
- **Tắt "Confirm email"** (email là email giả, không gửi được mail).

**Authentication → Sign In / Providers** (hoặc *Settings*):
- **Tắt "Allow new users to sign up"** → chặn mọi người tự tạo tài khoản bằng anon key.
  Tài khoản vẫn tạo được qua backend (`service_role` + Admin API); frontend không được chứa service role key.

**Authentication → Rate Limits**: giữ mặc định, hoặc nâng "Sign in" lên nếu 4000 người đăng nhập cùng lúc.
**Authentication → Sessions** (gói Pro): đặt *time-box / inactivity timeout* nếu muốn giới hạn phiên.
JWT expiry mặc định 3600s; client dùng `/auth/refresh` để gia hạn.

## 4. Lấy khóa
**Project Settings → API**:
| Giá trị | Biến môi trường | Ghi chú |
|---|---|---|
| Project URL | `SUPABASE_URL` | |
| `anon` public key | `SUPABASE_ANON_KEY` | an toàn đưa vào frontend |
| `service_role` key | `SUPABASE_SERVICE_ROLE_KEY` | **bí mật**, chỉ trên máy chủ/máy chấm |

```bash
cp data/.env.example data/.env      # rồi điền 3 khóa trên
```

## 5. Tạo admin đầu tiên và kiểm tra
```bash
.venv/bin/python -m backend.manage check
.venv/bin/python -m backend.manage create-admin btc@example.com btc_admin 'MatKhauManh123'
```

## 6. Đồng bộ dữ liệu giải đấu legacy

Các lệnh dưới đây vẫn thao tác SQLite `ott.db`; chỉ dùng để đối soát/chuyển dữ liệu cũ, không dùng làm backend demo v0. Không chạy đồng thời với luồng Supabase mới.
```bash
export OTT_SUPABASE_SYNC=1        # tự sync sau entry-close / close / grade (cả CLI và /admin)
.venv/bin/python -m data.sync     # hoặc sync tay bất kỳ lúc nào (idempotent)
```
Thứ tự đề xuất: tạo tài khoản thí sinh → thi đầu vào → `entry-close` (sync tự chạy) → mỗi ngày `close` rồi `grade`.

## 7. Dùng từ frontend (supabase-js)
Frontend có thể gọi trực tiếp Supabase bằng anon key + JWT của thí sinh:
```js
const { data: s } = await sb.rpc('get_group_leaderboard', { p_rnd: 1 });        // BXH bảng mình
const { data: m } = await sb.rpc('get_group_matches', { p_rnd: 1, p_day: 3 });  // trận trong ngày
const { data: me } = await sb.from('round_members').select('*');                // chỉ thấy dòng của mình
```
Frontend hiện gọi RPC/Storage với anon key + JWT. FastAPI Render chỉ giữ các API quản trị cần service role; submit được gửi trực tiếp tới Supabase và scoring module.

## 8. Checklist an toàn
- [ ] `data/.env` không commit (đã nằm trong `.gitignore`).
- [ ] Đã tắt public sign-up.
- [ ] RLS bật (script đã bật); thử đăng nhập 1 thí sinh và `select * from daily_results` chỉ thấy dòng của mình.
- [ ] Bật **Point-in-Time Recovery** / backup trước ngày thi (Pro) hoặc `pg_dump` định kỳ.
