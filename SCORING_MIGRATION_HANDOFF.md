# Kế hoạch migrate hệ thống chấm bài

Tài liệu này là handoff cho AI/engineer tiếp tục công việc. Migration đang thực hiện theo từng pha; các migration SQL mới trong repo chưa được áp dụng lên Supabase đang chạy và hệ thống chưa đủ điều kiện production.

## Mục tiêu đã thống nhất

- Supabase là dịch vụ trung tâm cho metadata bài nộp, trạng thái chấm, điểm, kết quả giải đấu và quyền truy cập.
- Module điều phối chấm tự host trên laptop; Judge0 giữ host port `2358`, API điều phối bind loopback port `8110` (đổi được qua `OTT_SCORING_PORT`), Cloudflare Tunnel expose hostname HTTPS.
- Khi nộp, ghi nhận yêu cầu ở Supabase và gửi bài cho module chấm. Module chấm xong callback kết quả lên Supabase; frontend nhận trạng thái/kết quả từ Supabase.
- Gỡ SQLite khỏi web/backend chạy trên Render. Dữ liệu game/replay dùng Postgres và private Supabase Storage; module chấm chỉ giữ source bot cần cho việc chạy Judge0.
- Duy trì tài liệu này và cập nhật checklist/decisions khi triển khai.

## Khảo sát repository (2026-10-20)

### Luồng submit hiện tại

- `frontend/src/App.tsx` gửi `POST /api/submit` qua `api()` trong `frontend/src/api.ts`.
- `backend/routers/contestant.py::submit_bot` gọi `T.submit()`, ghi `bots/<username>/latest.py`, rồi nếu `evaluate=1` chạy `evaluator.evaluate_bot_match()` ngay trong request.
- `backend/auth.py::ensure_local_user()` đồng bộ user vào SQLite `ott.db`; xác thực profile/token dựa trên Supabase.
- `tournament.py` dùng `ott.db` cho users, submissions, tournament state, matches, daily scores, replay và live scoring. `grade_day()` chạy các trận rồi ghi `matches`/`match_replays` vào SQLite.
- `data/sync.py` đẩy dữ liệu SQLite lên Supabase sau khi chạy lệnh BTC; đây là đồng bộ sau chấm, không phải hàng đợi chấm online.

### Supabase và replay hiện tại

- Schema hiện có `profiles`, `submissions`, `daily_results`, `matches`, `contest_days`, v.v. trong `data/supabase/migrations/0001_schema.sql`.
- Đã có `get_replay_ref(match_id)` RPC kiểm tra JWT, admin/cùng bảng và trạng thái ngày đã chấm; migration mới bổ sung RPC liệt kê replay trong phạm vi user.
- Trước cập nhật 2026-10-21, `data/replay_store.py` lưu JSON gzip trên disk và `data/storage_server.py` phục vụ replay local.
- Replay lịch sử từ `match_replays` SQLite chưa được migrate tự động; module mới tạo replay cho từng job entry/test.
- Frontend lấy metadata replay từ RPC, yêu cầu signed URL ngắn hạn qua Supabase Storage SDK rồi tải file từ Storage; payload JSON được gzip nén.

### Rủi ro kiến trúc cần xử lý

- Vercel không thể gọi `localhost` của người vận hành. URL `http(s)://host:2358` phải truy cập được từ trình duyệt người chơi, thường qua tunnel/reverse proxy; CORS và TLS cần được cấu hình. Không mở port trực tiếp mà không có xác thực.
- Browser không được gửi service-role key hoặc callback secret. Tạo job/status và ghi kết quả phải đi qua RPC/Edge Function/backend tin cậy.
- Hai request chạy đồng thời bằng cùng `job_id`; API đợi tối đa 2 giây để bản ghi Supabase xuất hiện. Frontend giới hạn ACK 10 giây, đọc lại trạng thái nếu response mơ hồ, rồi gọi RPC bù `dispatch_failed` nếu module không nhận.
- Supabase không tự timeout chỉ vì có cột thời gian. Migration có hàm watchdog nhưng chưa đăng ký scheduler; cần bật lịch chạy và chốt deadline.
- Một laptop có thể tắt/ngủ/mất mạng. Job cần trạng thái hết hạn, retry an toàn và khả năng operator chạy lại; cần quyết định mức bảo đảm khi module offline.
- `servers/scoring/judge0-v1.13.0/docker-compose.yml` đang publish Judge0 lên host port `2358`. Không thấy ứng dụng hiện gọi Judge0; `engine.py` chạy một subprocess bot tồn tại xuyên suốt trận, nhận trạng thái mỗi lượt qua stdin/stdout. Chủ dự án xác nhận muốn Judge0 làm sandbox; API điều phối sẽ ở port nội bộ khác sau hostname tunnel, Judge0 giữ `2358`.
- Judge0 chạy một chương trình cho stdin cố định; đã chốt bot function API `choose_move(state)` để cả trận BO2 chạy trong một sandbox Judge0 submission. Runner khởi động candidate trong child process bên trong Judge0 để giữ nhiều lượt và tách globals khỏi harness; phải xác minh Judge0 isolate cho phép child process, đồng thời benchmark và kiểm tra harness.
- File bot là dữ liệu không tin cậy. Giữ sandbox/giới hạn CPU, RAM, thời gian và quyền truy cập file; kiểm tra giới hạn upload ở module.
- Nếu Supabase đã ghi kết quả nhưng phản hồi callback bị mất, module phải retry callback cùng `job_id`; Supabase phải xử lý lặp idempotent.

## Thiết kế trạng thái và ngoại lệ đề xuất

### Trạng thái job

`dispatching -> accepted -> running -> succeeded | failed`; lỗi ACK thành `dispatch_failed`; watchdog chuyển `dispatching`/`accepted`/`running` quá hạn thành `timed_out`.

- `succeeded`: điểm và kết quả đã commit atomically lên Supabase. Frontend đọc kết quả từ Supabase/Realtime.
- `failed`: lỗi xác định như file không hợp lệ, bot lỗi runtime theo luật, hoặc engine lỗi không retry được. Lưu mã lỗi; không lưu stack trace/secret cho client.
- `timed_out`: chưa có kết quả trước deadline. Cho phép retry/requeue theo chính sách; kết quả đến muộn chỉ được chấp nhận nếu job vẫn là lần attempt hợp lệ, hoặc được lưu để operator reconcile.
- Với quyết định “không queue khi module offline”, lỗi ACK từ module bù trạng thái sang `dispatch_failed`. Nếu response mất sau khi module đã ACK, frontend đọc lại Supabase để tránh đánh dấu nhầm job đang chạy.
- `submission accepted` không đồng nghĩa chấm xong. UI hiển thị trạng thái chờ và subscribe/poll Supabase, không báo điểm trước khi commit.

### Luồng đề xuất (cần xác nhận)

1. Frontend tạo `job_id`, gọi Supabase RPC `create_scoring_job` và `POST /v1/jobs/{job_id}` đồng thời. Supabase giữ metadata/hash; file bot chỉ gửi trực tiếp module.
2. Module xác thực JWT qua Supabase Auth, kiểm tra job owner/hash/size bằng service role, lưu source theo UUID local, ACK và đưa job vào hàng đợi giới hạn.
3. Job `entry`/`test` chạy qua Judge0; job `submission` lưu version bất biến và metadata. Chấm ngày thật sẽ chuyển ở pha sau. Module lưu replay job gzip cục bộ.
4. RPC hoàn tất ghi điểm đầu vào hoặc metadata bài nộp cùng trạng thái `succeeded` trong transaction. Source và replay không được ghi vào Supabase.
5. Frontend dùng Supabase Realtime (hoặc polling nếu Realtime không phù hợp) để nhận trạng thái. Kết quả sau timeout cần reconcile, không được âm thầm ghi đè kết quả đã chấp nhận.
6. Watchdog chuyển job quá `deadline_at` thành `timed_out`; retry phải tạo attempt mới hoặc requeue có fencing token để callback cũ không ghi đè.

### Replay

- Máy chấm lưu file JSON gzip theo match ID/job ID và metadata giải đấu; tránh phụ thuộc vào tên user do client cung cấp.
- Supabase Storage private bucket `replays` lưu gzip JSON; `replay_objects` chỉ lưu metadata/hash/path. RLS cho metadata và Storage objects chỉ cho phép chủ job hoặc thành viên cùng bảng đã chấm/admin.
- Frontend tạo signed URL có thời hạn 120 giây và tải trực tiếp từ Supabase Storage. Dữ liệu replay không đi qua Render, tunnel hoặc API module.
- Module tải replay lên Storage trước khi báo kết quả job. Nếu upload lỗi, lỗi được log nhưng kết quả chấm vẫn được ghi; job thành công có thể chưa có replay và cần cơ chế sửa lại.

## Các quyết định cần chủ dự án xác nhận

1. **Đã trả lời:** nếu module không nhận ngay, submit thất bại (không queue chờ máy online).
2. **Đã trả lời:** expose module qua HTTPS Cloudflare Tunnel/hostname.
3. ACK 10s đã chọn; Judge0 giới hạn 140s; watchdog đề xuất timeout ở 180s. Chấm tự retry chưa bật; lỗi hạ tầng cần nộp lại. Cron scheduler chưa được tạo trong Supabase.
4. Chưa chốt số máy chấm đồng thời. Giả định ban đầu: một module authoritative có URL replay ổn định; nhiều máy cần routing/storage riêng.
5. **Đã trả lời:** phạm vi gồm entry, `/test-bot`, `close/grade` và quản trị giải đấu.
6. **Đã chọn cho submission mới:** source bất biến theo `job_id`; cần làm tiếp để `grade_day()` ghim version job ID thay vì đọc snapshot cũ `snaps/`.
7. **Đã trả lời:** Judge0 tiếp tục host port `2358`; API điều phối ở port nội bộ khác và đi qua hostname tunnel riêng.
8. **Đã trả lời:** cần tích hợp Judge0 làm sandbox chạy bot.
9. **Đã trả lời:** chấp nhận chuẩn hoá bot sang function API `choose_move(state)` để toàn trận chạy trong ít Judge0 submissions; cần chuyển đổi/giữ tương thích với bot stdin-loop cũ.

## Kế hoạch triển khai theo pha

- [x] Chốt quyết định ban đầu: thất bại ngay nếu module không nhận, dùng HTTPS tunnel, phạm vi gồm toàn bộ chức năng.
- [x] Tạo migration `0002_scoring_jobs.sql`: RLS read-own/admin, RPC create/accept/run/complete/fail/dispatch-fail/timeout, link submission metadata và RPC replay metadata.
- [x] Thêm Judge0 runner cho function bot, API module port `8110`, JWT/hash checks và bounded queue.
- [x] Chuyển frontend submit sang hai request song song, ACK 10 giây, theo dõi Supabase; replay mới đi qua private Storage.
- [ ] Chuyển bot mẫu/template sang `choose_move(state)` và hoàn thiện endpoint/chức năng `/test-bot`.
- [ ] Chuyển chấm ngày `grade_day`, live/offline score và thao tác admin sang module/Supabase; các phần này hiện vẫn ghi vào `ott.db`.
- [ ] Bỏ luồng chấm theo ngày/ghép cặp/grade/advancement còn trong `tournament.py` khỏi SQLite và chuyển sang worker module + Postgres RPC.
- [ ] Chuyển dữ liệu lịch sử SQLite hiện có lên Supabase; đối soát trước khi gỡ `tournament.py`, `data/sync.py` và `ott.db`. Các file SQLite này vẫn còn cho tool cũ, nhưng đã bị tách khỏi backend web hiện tại.
- [x] Thêm cấu hình mẫu cho port module `8110`, Judge0 `2358`, Vercel URL và Cloudflare Tunnel.
- [ ] Cập nhật triển khai Vercel, HTTPS/CORS/secret rotation và runbook laptop offline/recovery.
- [ ] Chuyển dữ liệu lịch sử SQLite hiện có lên Supabase/replay store; đối soát số lượng và điểm trước khi ngắt luồng cũ.

## Cập nhật triển khai hiệu năng (2026-10-21)

- [x] `backend/main.py` không còn import/khởi tạo `tournament.py`, không còn routes leaderboard/live/sample đọc file hoặc SQLite; chỉ giữ health và API quản trị cần service role. Bind port theo `PORT` của Render.
- [x] Xóa `backend/routers/contestant.py` khỏi code vì toàn bộ route trong đó gọi SQLite; frontend đọc dashboard từ một RPC Supabase.
- [x] Gỡ `ensure_local_user()` và cache profile không giới hạn khỏi auth. Auth và truy vấn profile chạy qua thread pool để không chặn event loop; backend không giữ cache dữ liệu người dùng.
- [x] Gỡ thao tác SQLite khỏi tạo tài khoản admin và `backend/manage.py check`.
- [x] Thêm `get_my_dashboard()` RPC gộp trạng thái, bảng xếp hạng, nhà vô địch và tiến độ thành một roundtrip.
- [x] Giảm polling job fallback từ 2 giây xuống 12 giây; Supabase Realtime là đường cập nhật chính.
- [x] Thêm migration `0004_replay_storage_and_web_api.sql`: bucket private 16 MiB/object, bảng metadata/hash, RLS đọc theo chủ job/thành viên bảng/admin, RPC metadata.
- [x] Module upload replay gzip lên Storage; frontend ký URL 120 giây và tải nội dung trực tiếp từ Supabase.
- [ ] Chưa áp dụng migration `0004` lên Supabase; phải chạy các migration `0001`–`0004` đúng thứ tự trước khi thử flow mới.
- [ ] Replay trận lịch sử chưa tự chuyển từ `ott.db`/`data/storage/replays`; RPC chỉ liệt kê replay có metadata `replay_objects`.
- [ ] SQLite vẫn được dùng bởi `tournament.py`, `data/sync.py`, `data/manage.py`, các batch/script legacy và tool/test cũ. `grade_day`, ghép cặp, advancement, offline/live scoring chưa được chuyển; vì vậy chưa thể xóa `ott.db` hoặc tuyên bố toàn bộ migration hoàn tất.
- [ ] Nếu replay upload fail, job chấm vẫn hoàn thành nhưng chưa có replay. Cần thêm retry/reconciliation và metric upload-failed trước production.
- [ ] Hạn chế file replay hiện là 16 MiB; cần đo kích thước thực tế và dung lượng/bandwidth Supabase trước khi demo nhiều trận.

### Cấu hình cần cho bản Render/Vercel demo

- Render API: `PORT` do Render cấp; `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OTT_CORS_ORIGINS` (domain Vercel chính xác, cộng localhost khi dev).
- Vercel: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SCORING_MODULE_URL`. Vẫn cần module chấm public HTTPS qua tunnel cho upload/chấm; replay không cần gọi tunnel.
- Không đưa service role key vào Vercel. Không bật public bucket; chỉ signed URL có thời hạn.
- Render free có thể cold start/sleep; giữ API khỏi đường đọc dashboard/replay nóng. Admin account create/import vẫn dùng Render.

## Các file liên quan

- `frontend/src/App.tsx`, `frontend/src/api.ts`, `frontend/src/Replay.tsx`
- `backend/auth.py`, `backend/main.py`
- `tournament.py`, `evaluator.py`, `engine.py`
- `data/supabase/migrations/0001_schema.sql`, `data/sync.py`, `data/replay_store.py`, `data/storage_server.py`
- `data/DATABASE_DESIGN.md`, `data/CLOUDFLARE_TUNNEL.md`, `servers/scoring/`

## Tiến độ

- [x] Khảo sát luồng hiện tại và ghi nhận kiến trúc/ngoại lệ.
- [x] Chốt thất bại ngay khi module không nhận, HTTPS tunnel, phạm vi toàn bộ và giữ Judge0 tại port `2358`.
- [x] Chọn ACK timeout 10s (frontend), bounded queue và một lần chạy; retry chấm tự động chưa bật.
- [x] Chốt execution interface: function bot `choose_move(state)` trong một Judge0 sandbox cho mỗi trận BO2.
- [x] Tạo migration và scoring module foundation (chưa apply SQL/chưa production-ready).
- [x] Chuyển frontend submit/replay foundation.
- [x] Thêm migration `0003_immediate_scoring_and_admin_phases.sql`: chấm mỗi lần gửi, cap 20 lượt vòng loại, giữ điểm tốt nhất, admin đặt phase và theo dõi scoring jobs.
- [ ] Gỡ SQLite khỏi luồng chấm và hoàn tất migration dữ liệu.

### Judge0 design notes (đã chốt execution interface)

- Judge0 HTTP API nhận một chương trình, stdin cố định và chạy tới khi process kết thúc; tài liệu không mô tả kênh gửi stdin tương tác thêm trong lúc chạy ([Create a Submission](https://github.com/judge0/judge0/blob/master/docs/api/submissions/create_a_submission.md), [Submissions API](https://github.com/judge0/judge0/blob/master/docs/api/submissions/submissions.md)). Engine OTT hiện yêu cầu một bot process tương tác nhiều lượt qua stdin/stdout.
- Không thấy trong giao thức Judge0 hiện tại một cách giữ process sống rồi gửi thêm stdin giữa lượt. Vì vậy không thể thay `ProcBot` bằng một HTTP call cho toàn trận mà giữ nguyên protocol.
- Phương án một submission mỗi nước đi bị loại vì khởi chạy sandbox lại, mất state nội bộ và tạo tới hàng trăm submissions mỗi trận.
- **Đã chọn:** adapter function-based (`choose_move(state)`) cho toàn trận trong một Judge0 submission. Trusted harness chạy trong Judge0; candidate chạy trong process con persistent; parent kiểm tra nước đi và áp timeout mỗi lượt. Cần xác minh child process trong isolate trước production. Bot stdin-loop top-level phải chuyển API hoặc nộp lại.
- Không được fallback sang chạy bot trực tiếp trong API module/engine process; như vậy phá sandbox isolation.
- Cần benchmark Judge0 limits, queue saturation, timeout/resource limits, output parsing và kiểm tra bot không thể làm giả kết quả harness trước khi production.

## Trạng thái code trong workspace

- `data/supabase/migrations/0002_scoring_jobs.sql` mới tạo; phải review/apply lên Supabase project trước khi frontend submit mới hoạt động.
- `servers/scoring/module.py` chỉ bind `127.0.0.1:8110` và dùng `backend.supabase_client`/service role. Bảo mật service-role key trong máy module.
- `servers/scoring/judge0_runner.py` chạy `choose_move(state)`/`choose_best_move(state)` trong một Judge0 Python submission cho BO2, spawn candidate subprocess giữ sống theo ván; child process trong isolate chưa được xác minh. Migration 0003 chuyển upload sang chấm ngay, giới hạn 20 lượt phase entry và giữ điểm cao nhất. Flow giải đấu theo ngày/grade_day vẫn chưa được chuyển.
- `frontend/src/App.tsx` / `api.ts` đã đổi submit sang RPC + module song song, và đang poll Supabase job. Cần set `VITE_SCORING_MODULE_URL` ở Vercel, `OTT_SCORING_CORS_ORIGINS` trong module và hostname `score.example.com` qua Tunnel.
- Replay UI đọc metadata từ `get_my_replay_matches`, ký URL qua Supabase Storage SDK và tải gzip trực tiếp; replay job mới chỉ xuất hiện sau khi `0004` được apply.
- Source bot vẫn được lưu local theo job ID để module chuyển tiếp Judge0; không được dùng thư mục source làm replay/cache web.
- `.gitignore` trước đây bỏ qua toàn bộ `servers/`; đã thêm ngoại lệ hẹp cho source/config cần thiết.
- `judge0.conf` vẫn bị ignore vì chứa credentials local. Các giới hạn cần thiết được ghi trong `data/CLOUDFLARE_TUNNEL.md`; chỉ commit Compose, không commit `judge0.conf`.
- Chưa chạy test/build. Không coi trạng thái code hiện tại là deploy-ready: chấm giải ngày, admin, live/offline và các đường SQLite chưa migrate.
