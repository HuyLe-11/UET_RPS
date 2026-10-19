# Máy local làm server file qua Cloudflare Tunnel

Máy local giữ replay trong `data/storage/` và chạy `data/storage_server.py`. Cloudflare Tunnel đưa nó ra
Internet qua HTTPS mà **không mở cổng, không cần IP tĩnh**.

```
Trình duyệt ──HTTPS──► files.<domain> (Cloudflare) ──tunnel──► cloudflared ──► 127.0.0.1:8100 (storage_server)
```

## Yêu cầu
- Tài khoản Cloudflare (miễn phí) có 1 domain đã trỏ nameserver về Cloudflare.
- Máy local bật liên tục trong thời gian thi (tắt sleep). Nên dùng UPS/mạng ổn định.

## 1. Chạy storage server
```bash
pip install flask waitress
# từ thư mục gốc dự án, đã có data/.env
.venv/bin/python -m waitress --listen=127.0.0.1:8100 data.storage_server:app
# kiểm tra
curl http://127.0.0.1:8100/healthz        # {"ok":true}
```
Chỉ bind `127.0.0.1` – chỉ cloudflared mới vào được.

## 2. Cài cloudflared
- macOS: `brew install cloudflared`
- Windows: `winget install --id Cloudflare.cloudflared`
- Linux: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

## 3. Tạo tunnel
```bash
cloudflared tunnel login                                  # mở trình duyệt, chọn domain
cloudflared tunnel create ott-storage                     # in ra <TUNNEL_UUID>, tạo file credentials .json
cloudflared tunnel route dns ott-storage files.example.com
```
Tạo `~/.cloudflared/config.yml` từ mẫu [`cloudflared.config.example.yml`](cloudflared.config.example.yml)
(thay `<TUNNEL_UUID>`, hostname). Chạy thử:
```bash
cloudflared tunnel run ott-storage
curl https://files.example.com/healthz
```

### Thử nhanh không cần domain
```bash
cloudflared tunnel --url http://127.0.0.1:8100            # cấp URL https://xxxx.trycloudflare.com tạm thời
```
Chỉ để test, URL đổi mỗi lần chạy.

## 4. Chạy như dịch vụ (tự khởi động lại)
- macOS/Linux: `sudo cloudflared servicurl https://abc-xyz.trycloudflare.com/healthzce install` (dùng `~/.cloudflared/config.yml` hoặc `/etc/cloudflared/config.yml`).
- Windows (PowerShell admin): `cloudflared service install` rồi `sc start cloudflared`.
- Storage server tự khởi động: Windows dùng Task Scheduler (`At startup`) chạy
  `python -m waitress --listen=127.0.0.1:8100 data.storage_server:app` trong thư mục dự án;
  macOS dùng `launchd`; Linux dùng `systemd`.

## 5. Cấu hình CORS và frontend
Trong `data/.env`: `OTT_CORS_ORIGINS=https://ott.example.com` (domain web của thí sinh). Frontend lấy replay:
```js
const r = await fetch(`https://files.example.com/replays/${matchId}`,
                      { headers: { Authorization: `Bearer ${accessToken}` } });
const games = await r.json();     // trình duyệt tự giải nén gzip
```
`matchId` lấy từ RPC `get_group_matches` (cột `match_id`, `has_replay`).

## 6. Bảo mật & hiệu năng
- **Quyền truy cập**: do Supabase quyết định (RLS). Không đăng nhập / khác bảng / ngày chưa chấm → 401/404.
- Code bot (`bots/`, `snaps/`) **không** nằm trong `data/storage/` và storage server không có route trả code.
- Cloudflare dashboard → **Security → WAF → Rate limiting**: giới hạn ~60 request/phút/IP cho `files.<domain>/replays/*`.
- Replay đã nén gzip (~vài chục KB/trận). Bật cache Cloudflare **không** áp dụng được vì response là `private`; tải lớn
  thì giảm bằng cache phía trình duyệt (đã đặt `max-age=3600`).
- Không tunnel cổng SSH/DB; chỉ ingress tới 8100 (và 8000 nếu cần).
- Sao lưu `data/storage/` (rsync/Time Machine/ổ ngoài) cùng `ott.db`.

## 7. Xử lý sự cố
| Triệu chứng | Cách xử lý |
|---|---|
| `502 Bad Gateway` ở Cloudflare | storage server chưa chạy / sai cổng trong `config.yml` |
| `401` dù đã đăng nhập | access token hết hạn → gọi `/auth/refresh` |
| `404 Replay chưa có trên máy chủ` | chưa chạy `python -m data.sync` (xuất replay ra file) |
| Lỗi CORS | thêm origin vào `OTT_CORS_ORIGINS`, khởi động lại storage server |
