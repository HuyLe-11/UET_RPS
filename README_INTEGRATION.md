# Bản kết hợp main + Huylkq

Thư mục này là bản ghép riêng. Không thay đổi hai thư mục nguồn.

## Nguồn và quyết định ghép

- Frontend: giao diện React + TypeScript + Vite từ `OTT_Arena_React_Demo/Thi_dau_bot_OTT_N3-main`, commit `feaea2f`.
- Backend: nhánh `Huylkq` tại `lexuanbac-06/Thi_dau_bot_OTT_N3`, commit `578da6f`.
- Sau khi bỏ khác biệt xuống dòng LF/CRLF, các component React của hai nguồn giống nhau.
- Vì vậy dùng nhánh Huylkq làm nền, giữ engine, giải đấu, evaluator, tầng Supabase và trang admin/live của nhánh này.
- Bổ sung cầu nối API và sửa frontend để gọi Python thật. Không còn tài khoản hay bài nộp giả trong JavaScript.
- Không sao chép DB giải đấu, bot đã nộp, khóa bí mật hoặc `.git` của các nguồn. Khi chạy tạo DB mới cho bản kết hợp.

## Bước 1 — cài và chạy backend

Terminal ở thư mục chứa `server.py`:

```powershell
pip install -r requirements.txt
$env:OTT_AUTH_MODE = "demo"
python server.py
```

Để terminal này mở. Backend chạy cổng **8000**.

Tài khoản có sẵn: **demo / Demo@123456**. Không cần tài khoản Supabase để thử local.
Mật khẩu được băm và lưu trong bộ nhớ Python. Tài khoản đăng ký thêm mất sau khi khởi động lại backend.
Tên thi đấu, bài nộp và kết quả vẫn lưu trong SQLite/thư mục bots theo kiến trúc backend gốc.
Tên tài khoản tạm đã mất nhưng còn tồn tại trong DB giải đấu sẽ không được đăng ký chiếm lại; dùng tên mới hoặc vận hành bằng Supabase khi cần lưu tài khoản lâu dài.

## Bước 2 — chạy React

Mở terminal thứ hai, ở thư mục dự án:

```powershell
cd frontend
npm ci
npm run dev
```

Mở **http://localhost:5173**, đăng nhập bằng tài khoản trên.
Giữ cả hai terminal chạy. Dùng cùng hostname `localhost` trong khi thử để cookie được dùng thống nhất.

**Vite proxy** chuyển yêu cầu `/api`, `/submit`, `/me`, `/admin`, `/live`… sang Python cổng 8000.
Trình duyệt chỉ thấy cùng một địa chỉ nên cookie phiên hoạt động mà không cần bật CORS tùy tiện.

## Bước 3 — kiểm tra liên kết

1. Nhập sai mật khẩu: thấy lỗi từ backend, không được vào trang tổng quan.
2. Đăng nhập đúng: mục trạng thái hiển thị người chơi `demo`.
3. Tải lại trang: vẫn đăng nhập nếu backend chưa khởi động lại.
4. Tải/xem `sample_bot.py`, chọn file đó và nộp. Trong terminal Python xuất hiện `POST /submit 200`.
5. Kiểm tra `bots/demo/latest.py` và dữ liệu bài nộp trong `ott.db`: file đã được lưu thật.
6. Đăng xuất: `/me` không còn truy cập được trong phiên đó.

Bảng xếp hạng và replay chưa có dữ liệu trước khi BTC chấm. Không hiển thị kết quả giả.
Trang `/live` của nhánh Huylkq vẫn cập nhật tiến độ/điểm bằng snapshot, chưa phải phát nước đi WebSocket.

## Chạy một cổng sau khi build

```powershell
# Trong frontend
npm run build
cd ..
python server.py
```

Mở **http://localhost:8000**. Flask phục vụ React từ `frontend/dist` và các API cùng cổng.
`cd ..` nghĩa là từ frontend quay lên thư mục chứa server.py.

## Quản trị local

Trước khi khởi động backend, có thể đặt một mật khẩu quản trị do bạn chọn:

```powershell
$env:OTT_AUTH_MODE = "demo"
$env:ADMIN_PASSWORD = "mat-khau-quan-tri-cua-ban"
python server.py
```

Đăng nhập React bằng **admin_local** và mật khẩu đã đặt. Backend phân quyền admin và React chuyển tới `/admin`.
Không có tài khoản admin mặc định khi chưa đặt ADMIN_PASSWORD. Reset toàn bộ giải là chức năng gốc có xóa dữ liệu; không cần reset để thử giao diện.

## Dùng Supabase của Huylkq

Giữ nguyên hướng dẫn `data/SUPABASE_SETUP.md` và migration SQL của nhánh nguồn.
Sao chép `data/.env.example` thành `data/.env`, cấu hình Supabase URL, anon key và service role **ở backend**,
đổi `OTT_AUTH_MODE=supabase` rồi khởi động lại Python.

- Đặt FLASK_SECRET_KEY riêng, ổn định khi triển khai.
- Không đưa service role key vào frontend hoặc GitHub.
- Tài khoản demo không tồn tại trong Supabase; đăng ký tài khoản thật sau khi cấu hình.
- Kiểm thử tích hợp có giả lập lớp Supabase; chưa đăng nhập vào một dự án Supabase thật thay cho bạn.

## File đã chỉnh và lý do

| File | Thay đổi |
|---|---|
| `server.py` | Phục vụ React build; thêm alias `/api/auth/*`; trả user.name, CSRF và cấu hình; chọn demo/Supabase; xử lý log UTF-8 Windows |
| `data/local_auth.py` | Tài khoản demo trong Python, băm mật khẩu và quản lý token phiên, dùng lại API giải đấu |
| `frontend/src/api.ts` | Bỏ API giả; dùng fetch gửi cookie và CSRF; giải thích lỗi backend trả HTML |
| `frontend/src/Auth.tsx` | Đăng nhập thật, phản ánh backend đã cấu hình và đăng ký đang mở/đóng |
| `frontend/src/App.tsx` | Lấy lại phiên khi tải trang, chuyển admin, thông báo nộp thật |
| `frontend/vite.config.ts` | Chuyển tiếp đủ API, trang admin/live trong dev và preview |
| `frontend/public/sample_bot.py` | Đồng bộ bot mẫu với backend Huylkq |
| Tests | Kiểm tra giao thức frontend và toàn bộ đường đăng nhập → lưu bài → đọc kết quả bằng Flask |

`engine.py`, `tournament.py`, `evaluator.py`, các thành phần dữ liệu và template admin/live được lấy nguyên từ Huylkq.

## Hiểu luồng trước khi sửa tiếp

```text
Auth.tsx (form) → api.ts (fetch + CSRF) → server.py → dịch vụ tài khoản
                              ↓ cookie phiên được trình duyệt giữ
App.tsx (upload) → POST /submit → kiểm tra cú pháp → bots/<tên>/latest.py + ott.db
App.tsx / Replay.tsx → GET /leaderboard, /replays → dữ liệu giải đấu đã chấm
```

- **State** (`useState`) giữ dữ liệu màn hình, như người đang đăng nhập hoặc file đang chọn. State không tự lưu vào DB.
- **Props** là dữ liệu component cha truyền xuống: App truyền cấu hình và hàm `onLogin` cho Auth.
- **Hook useEffect** chạy việc lấy phiên khi App được mở. Nó hỏi backend xem cookie hiện tại còn hợp lệ không.
- **CSRF** là mã kiểm tra đi cùng yêu cầu thay đổi dữ liệu. Backend so mã này với mã trong phiên.
- Cookie HttpOnly do trình duyệt gửi tự động; JavaScript không đọc token đăng nhập để lưu vào localStorage.

## Chạy kiểm thử

```powershell
# Thư mục gốc
python -m unittest discover -s tests
python -X utf8 -m unittest data.tests.test_data_layer

# Trong frontend
npm test
npm run build
```

Các kiểm thử backend dùng DB tạm riêng, không chấm hoặc reset giải đang chạy.

## Ba câu hỏi ôn tập

1. Khi React gọi `/submit` ở cổng 5173, phần nào chuyển yêu cầu sang Python cổng 8000?
2. Vì sao state `user` trong React chưa đủ chứng minh người dùng có quyền gọi API?
3. Tài khoản demo và file bot đã nộp được lưu ở đâu, dữ liệu nào mất khi khởi động lại Python?
