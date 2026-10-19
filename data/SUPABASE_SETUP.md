# Cấu hình Supabase

## 1. Tạo project
1. Vào https://supabase.com → **New project** (chọn region gần VN: Singapore).
2. Lưu **Database password**. Đợi project khởi tạo xong.

## 2. Chạy schema
**Dashboard → SQL Editor → New query**, dán toàn bộ
[`supabase/migrations/0001_schema.sql`](supabase/migrations/0001_schema.sql) → **Run**.
(Hoặc dùng CLI: `supabase link --project-ref <ref> && supabase db push`.)
Script chạy lại nhiều lần được.

## 3. Cấu hình Auth
**Authentication → Providers → Email**:
- Bật **Email** provider.
- **Tắt "Confirm email"** (email là email giả, không gửi được mail).

**Authentication → Sign In / Providers** (hoặc *Settings*):
- **Tắt "Allow new users to sign up"** → chặn mọi người tự tạo tài khoản bằng anon key.
  Tài khoản vẫn tạo được qua backend (`service_role` + Admin API) bằng `data/manage.py` hoặc `POST /auth/register`.

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
.venv/bin/python -m data.manage check
.venv/bin/python -m data.manage create-user btc_admin 'MatKhauManh123' --admin
.venv/bin/python -m data.manage import-users users.csv     # tùy chọn: dòng "username,password"
```

## 6. Đồng bộ dữ liệu thi đấu
```bash
export OTT_SUPABASE_SYNC=1        # tự sync sau entry-close / close / grade (cả CLI và /admin)
.venv/bin/python -m data.sync     # hoặc sync tay bất kỳ lúc nào (idempotent)
```
Thứ tự đề xuất: tạo tài khoản thí sinh → thi đầu vào → `entry-close` (sync tự chạy) → mỗi ngày `close` rồi `grade`.

## 7. Dùng từ frontend (supabase-js, tùy chọn)
Frontend có thể gọi trực tiếp Supabase bằng anon key + JWT của thí sinh:
```js
const { data: s } = await sb.rpc('get_group_leaderboard', { p_rnd: 1 });        // BXH bảng mình
const { data: m } = await sb.rpc('get_group_matches', { p_rnd: 1, p_day: 3 });  // trận trong ngày
const { data: me } = await sb.from('round_members').select('*');                // chỉ thấy dòng của mình
```
Hoặc dùng API Flask: `POST /auth/login` → gửi `Authorization: Bearer <access_token>` tới `/me`, `/submit`, `/leaderboard`, `/replays`.

## 8. Checklist an toàn
- [ ] `data/.env` không commit (đã nằm trong `.gitignore`).
- [ ] Đã tắt public sign-up.
- [ ] RLS bật (script đã bật); thử đăng nhập 1 thí sinh và `select * from daily_results` chỉ thấy dòng của mình.
- [ ] Bật **Point-in-Time Recovery** / backup trước ngày thi (Pro) hoặc `pg_dump` định kỳ.
