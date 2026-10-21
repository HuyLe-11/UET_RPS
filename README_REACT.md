# OTT Arena — React + TypeScript, demo không SQLite

Tài khoản có sẵn: **demo** / **Demo@123456**.
Đã điền sẵn trong form. Có thể bấm **Vào bằng tài khoản demo**.

## Chạy giao diện độc lập

Cần Node.js 22.12+ hoặc 24+ và npm. Không cần Python hoặc SQLite.

```powershell
cd frontend
npm ci
npm run dev
```

Mở http://localhost:5173.

Hoặc xem bản build có sẵn trong ZIP:

```powershell
cd frontend
npm ci
npm run preview
```

Mở http://localhost:4173. Không nhấp đúp index.html.

## Chế độ demo

Đăng nhập, tạo tài khoản, đăng xuất được xử lý trong bộ nhớ JavaScript.
Tài khoản tạo thêm và phiên đăng nhập mất khi tải lại trang hoặc đóng tab.
Tài khoản demo luôn được tạo lại khi tải trang. Không lưu thông tin tài khoản vào SQLite.
Đây là xác thực mô phỏng để thử giao diện, không bảo vệ dữ liệu thật.

Có giao diện tổng quan, chọn bot Python, bảng xếp hạng, phát lại và luật chơi.
Chọn/nộp bot trong demo chỉ ghi nhận tên file trong bộ nhớ, không upload hay chấm thi.
Không tạo điểm hoặc trận giả: bảng xếp hạng và phát lại hiển thị trạng thái chưa có dữ liệu.

## Backend gốc

Python, DB và các trang /admin, /live được giữ nguyên để tích hợp về sau.
Các trang đó cần chạy backend và DB giải đấu nếu muốn sử dụng.
Giao diện React mặc định hoạt động độc lập, không gọi backend để xác thực hoặc chấm thi.
server.py có thêm phục vụ React build tại / và /assets.
Không thêm bảng tài khoản SQLite mới.

## Mã nguồn

- frontend/src/Auth.tsx: đăng nhập, đăng ký và tài khoản demo.
- frontend/src/api.ts: tài khoản trong bộ nhớ, hằng DEMO_ACCOUNT và API mô phỏng.
- frontend/src/App.tsx: tổng quan và các mục thi đấu.
- frontend/src/Replay.tsx: thành phần phát lại trận.
- frontend/src/styles.css: thiết kế tông tối/tím, thích ứng điện thoại.
- frontend/public/sample_bot.py: bot mẫu xem trực tiếp, không cần backend.

## Kiểm tra và build

```powershell
cd frontend
npm test
npm run build
```

Bản build đặt trong frontend/dist. Các template HTML cũ được giữ để tham khảo.
