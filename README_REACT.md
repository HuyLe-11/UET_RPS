# React + TypeScript đã kết nối backend

Đây là bản kết hợp main + Huylkq, không còn chạy độc lập bằng API giả.
Xem **README_INTEGRATION.md** ở cùng thư mục để biết cách chạy và file đã sửa.

Mở hai terminal:

1. Thư mục gốc: pip install -r requirements.txt, sau đó python server.py.
2. Thư mục frontend: npm ci, sau đó npm run dev.

Mở http://localhost:5173. Nếu đã build bằng npm run build, có thể mở http://localhost:8000 qua Flask.
Tài khoản local mặc định: demo / Demo@123456.
Tài khoản local được giữ trong bộ nhớ Python; bài nộp/kết quả giải được lưu thật.
Đặt OTT_AUTH_MODE=supabase khi muốn dùng tầng tài khoản Supabase của Huylkq.
