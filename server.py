"""Server thi đấu. Chạy: pip install flask && python server.py

Xác thực: mọi tài khoản (thí sinh + ban tổ chức) và mật khẩu nằm trên Supabase Auth.
Server không lưu mật khẩu: sau khi đăng nhập, access/refresh token của Supabase được giữ trong
cookie phiên (HttpOnly, đã ký). Quyền ban tổ chức = profiles.role = 'admin' trên Supabase.
Thí sinh KHÔNG bao giờ xem được code của nhau: không có endpoint nào trả về nội dung bài nộp.

GET  /login                         màn hình đăng nhập / đăng ký (trang duy nhất xem được khi chưa đăng nhập)
POST /auth/login    json {username,password}   (header X-CSRF-Token)
POST /auth/register json {username,password}   (header X-CSRF-Token)
POST /auth/logout                               (header X-CSRF-Token)
GET  /auth/me
GET  /                trang thí sinh     |  GET /admin   trang ban tổ chức (role admin)
POST /submit form file=@bot.py | GET /me | GET /leaderboard[?day=] | GET /replays
"""
import json
import os
import secrets
import sys
import threading
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from functools import wraps
from urllib.parse import urlparse

from flask import (Flask, abort, g, jsonify, redirect, render_template, request, send_file,
                   send_from_directory, session, url_for)

import tournament as T
from data import auth_service as A
from data import config as data_config
from data.supabase_client import SupabaseError

# Windows consoles may default to cp1258, which cannot encode all Vietnamese logs.
for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8", errors="backslashreplace")

# Use Supabase when configured; keep a backend demo account for local learning.
AUTH_MODE = os.environ.get("OTT_AUTH_MODE") or (
    "supabase" if os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_ANON_KEY") else "demo"
)
if AUTH_MODE not in ("demo", "supabase"):
    raise RuntimeError("OTT_AUTH_MODE phai la demo hoac supabase")
if AUTH_MODE == "demo":
    from data import local_auth as A

app = Flask(__name__)
FRONTEND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "frontend", "dist")
app.config["MAX_CONTENT_LENGTH"] = 2 * 1024 * 1024
app.config["TEMPLATES_AUTO_RELOAD"] = True
# Khóa ký cookie phiên (không phải mật khẩu). Đặt cố định để phiên còn hiệu lực qua các lần khởi động lại.
app.secret_key = os.environ.get("FLASK_SECRET_KEY") or secrets.token_hex(32)
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=30)
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_SECURE"] = os.environ.get("SESSION_COOKIE_SECURE", "").lower() in ("1", "true", "yes")
T.init()
T.publish_live_tournament_snapshot()

_admin_executor = ThreadPoolExecutor(max_workers=1)
_admin_job_lock = threading.Lock()
_admin_job = None


# ---------------- PHIÊN ĐĂNG NHẬP (Supabase) ----------------
def supabase_configured():
    return AUTH_MODE == "demo" or bool(os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_ANON_KEY"))


def csrf_token():
    return session.setdefault("csrf_token", secrets.token_urlsafe(32))


def _store_session(tokens, user):
    csrf = session.get("csrf_token")
    session.clear()                                   # chống session fixation
    session.permanent = True
    session["csrf_token"] = csrf or secrets.token_urlsafe(32)
    session["sb"] = {"at": tokens["access_token"], "rt": tokens["refresh_token"],
                     "exp": time.time() + int(tokens.get("expires_in") or 3600),
                     "uid": user["id"]}


def current_user():
    """Profile Supabase của người đang đăng nhập ({id, username, role, status}) hoặc None."""
    if "user" in g:
        return g.user
    g.user = None
    s = session.get("sb")
    if not s:
        return None
    try:
        if "exp" in s and time.time() > s["exp"] - 60:               # gia hạn access token bằng refresh token
            t = A.refresh(s.get("rt", ""))
            s = {**s, "at": t["access_token"], "rt": t["refresh_token"],
                 "exp": time.time() + int(t.get("expires_in") or 3600)}
            session["sb"] = s
        g.user = A.verify_token(s["at"])
    except (PermissionError, SupabaseError, RuntimeError):
        session.pop("sb", None)
    return g.user


def _csrf_ok():
    supplied = request.headers.get("X-CSRF-Token") or request.form.get("csrf_token") or ""
    expected = session.get("csrf_token", "")
    return bool(expected) and secrets.compare_digest(supplied, expected)


def _safe_next(target):
    p = urlparse(target or "")
    return target if target and not p.scheme and not p.netloc and target.startswith("/") else None


def page_login_required(admin=False):
    """Trang HTML: chưa đăng nhập -> chuyển về /login; không phải admin -> 403."""
    def deco(fn):
        @wraps(fn)
        def wrapped(*a, **kw):
            user = current_user()
            if not user:
                return redirect(url_for("login_page", next=request.full_path.rstrip("?")))
            if admin and user["role"] != "admin":
                return render_template("forbidden.html", user=user), 403
            return fn(*a, **kw)
        return wrapped
    return deco


def api_login_required(admin=False):
    """API JSON: 401 khi chưa đăng nhập, 403 khi thiếu quyền hoặc sai CSRF (với request ghi)."""
    def deco(fn):
        @wraps(fn)
        def wrapped(*a, **kw):
            user = current_user()
            if not user:
                return jsonify(ok=False, error="Cần đăng nhập"), 401
            if admin and user["role"] != "admin":
                return jsonify(ok=False, error="Cần quyền ban tổ chức"), 403
            if request.method != "GET" and not _csrf_ok():
                return jsonify(ok=False, error="Phiên thao tác hết hạn. Hãy tải lại trang."), 403
            return fn(*a, **kw)
        return wrapped
    return deco


admin_required = api_login_required(admin=True)


def _client():
    return request.headers.get("CF-Connecting-IP") or request.remote_addr, request.headers.get("User-Agent")


def _home_for(user):
    return "/admin" if user["role"] == "admin" else "/"


def frontend_user(user):
    return {**user, "name": user["username"],
            "role": "admin" if user["role"] == "admin" else "player"} if user else None


@app.get("/api/auth/session")
def frontend_session():
    # The login form needs a CSRF token even before a user is authenticated.
    return jsonify(user=frontend_user(current_user()), csrf=csrf_token(), mode=AUTH_MODE,
                   configured=supabase_configured(), open_registration=data_config.OPEN_REGISTRATION)


def react_page():
    if os.path.isfile(os.path.join(FRONTEND_DIR, "index.html")):
        return send_from_directory(FRONTEND_DIR, "index.html")
    return ("Chua build React. Chay npm ci va npm run build trong frontend, "
            "hoac npm run dev va mo http://localhost:5173."), 503


@app.get("/assets/<path:filename>")
def frontend_asset(filename):
    return send_from_directory(os.path.join(FRONTEND_DIR, "assets"), filename)


@app.get("/login")
def login_page():
    user = current_user()
    if user:
        return redirect(_safe_next(request.args.get("next")) or _home_for(user))
    return render_template("login.html", csrf=csrf_token(), configured=supabase_configured(),
                           open_registration=data_config.OPEN_REGISTRATION)


@app.route("/auth/login", methods=["POST"])
@app.route("/api/auth/login", methods=["POST"])
@app.route("/login", methods=["POST"])
def auth_login():
    is_json = request.is_json
    if not _csrf_ok():
        if is_json:
            return jsonify(ok=False, error="Phiên đăng nhập hết hạn. Hãy tải lại trang."), 403
        return render_template("login.html", csrf=csrf_token(), configured=supabase_configured(),
                               open_registration=data_config.OPEN_REGISTRATION,
                               error="Phiên đăng nhập hết hạn. Hãy tải lại trang."), 403
    p = request.get_json(silent=True) or request.form.to_dict() or {}
    if not isinstance(p, dict):
        return jsonify(error="Du lieu dang nhap khong hop le"), 400
    username = str(p.get("username") or p.get("name") or "").strip()
    password = str(p.get("password") or "")
    ip, ua = _client()
    try:
        r = A.login(username, password, ip, ua)
    except PermissionError as e:
        if is_json:
            return jsonify(ok=False, error=str(e)), 401
        return render_template("login.html", csrf=csrf_token(), configured=supabase_configured(),
                               open_registration=data_config.OPEN_REGISTRATION,
                               error=str(e)), 401
    except (SupabaseError, RuntimeError):
        app.logger.exception("Supabase login failed")
        if is_json:
            return jsonify(ok=False, error="Không kết nối được máy chủ xác thực"), 502
        return render_template("login.html", csrf=csrf_token(), configured=supabase_configured(),
                               open_registration=data_config.OPEN_REGISTRATION,
                               error="Không kết nối được máy chủ xác thực"), 502
    _store_session(r, r["user"])
    if r["user"]["role"] != "admin":
        A.ensure_local_user(r["user"]["username"])    # ott.db cần dòng users để engine chấm
    target = _safe_next(p.get("next") or request.args.get("next")) or _home_for(r["user"])
    if is_json:
        return jsonify(ok=True, user=frontend_user(r["user"]), csrf=csrf_token(), redirect=target)
    return redirect(target)


@app.post("/auth/register")
@app.post("/api/auth/register")
def auth_register():
    if not _csrf_ok():
        return jsonify(ok=False, error="Phiên đăng nhập hết hạn. Hãy tải lại trang."), 403
    if not data_config.OPEN_REGISTRATION:
        return jsonify(ok=False, error="Đăng ký đang đóng"), 403
    p = request.get_json(silent=True) or {}
    if not isinstance(p, dict):
        return jsonify(error="Du lieu dang ky khong hop le"), 400
    username = p.get("username") or p.get("name")
    ip, ua = _client()
    with _admin_job_lock:
        if tournament_reset_running():
            return jsonify(ok=False, error="Cuộc thi đang được reset. Vui lòng thử lại sau."), 503
    try:
        A.create_account(username, p.get("password"), ip=ip, ua=ua)
        r = A.login(username, p.get("password"), ip, ua)
    except ValueError as e:
        return jsonify(ok=False, error=str(e)), 400
    except SupabaseError as e:
        dup = e.status in (409, 422) and "regist" in str(e).lower()
        return jsonify(ok=False, error="Tên đã tồn tại" if dup else "Không tạo được tài khoản"), 409 if dup else 502
    except PermissionError as e:
        return jsonify(ok=False, error=str(e)), 401
    except RuntimeError:
        app.logger.exception("Authentication service not configured")
        return jsonify(error="Chua cau hinh dich vu xac thuc. Xem data/.env.example."), 503
    _store_session(r, r["user"])
    return jsonify(ok=True, user=frontend_user(r["user"]), csrf=csrf_token(), redirect="/"), 201


@app.post("/auth/logout")
@app.post("/api/auth/logout")
def auth_logout():
    if not _csrf_ok():
        return jsonify(ok=False, error="Phiên thao tác hết hạn. Hãy tải lại trang."), 403
    s = session.get("sb")
    if s:
        ip, ua = _client()
        try:
            A.logout(s["at"], ip, ua)                 # thu hồi refresh token trên Supabase
        except (PermissionError, SupabaseError, RuntimeError):
            pass
    session.clear()
    return jsonify(ok=True, csrf=csrf_token(), redirect="/")


@app.get("/auth/me")
@api_login_required()
def auth_me():
    return jsonify(ok=True, user=current_user())


# ---------------- TRANG ----------------
@app.get("/")
def home():
    user = current_user()
    if user and user["role"] == "admin":
        return redirect("/admin")
    return react_page()


@app.get("/live")
@page_login_required()
def live_tournament():
    return render_template("live.html", user=current_user(), csrf=csrf_token())


@app.get("/live-board.json")
def live_tournament_board():
    response = send_file(
        T.LIVE_BOARD_SNAPSHOT,
        mimetype="application/json",
        conditional=True,
        max_age=20,
    )
    response.headers["Cache-Control"] = (
        "public, max-age=10, s-maxage=20, stale-while-revalidate=40"
    )
    return response


@app.get("/sample_bot.py")
def sample_bot():
    """Cho thí sinh xem mã nguồn bot mẫu."""
    return send_from_directory(app.root_path, "sample_bot.py", mimetype="text/plain")


@app.get("/admin")
@page_login_required(admin=True)
def admin():
    return render_template("admin.html", csrf=csrf_token(), user=current_user())


@app.post("/admin/logout")
def admin_logout():
    return auth_logout()


@app.get("/admin/api/overview")
@admin_required
def admin_overview():
    return jsonify(T.admin_overview())


@app.get("/champion")
def champion():
    return jsonify(champion=T.get("champion"))


@app.get("/live-leaderboard")
def live_leaderboard():
    return jsonify(T.live_leaderboard())


@app.get("/admin/api/job")
@admin_required
def admin_job_status():
    with _admin_job_lock:
        return jsonify(_admin_job or {"state": "idle"})


def start_admin_job(action, work):
    global _admin_job
    with _admin_job_lock:
        if _admin_job and _admin_job["state"] == "running":
            return jsonify(ok=False, error="Một thao tác quản trị khác đang chạy."), 409
        job_id = uuid.uuid4().hex
        _admin_job = {"id": job_id, "action": action, "state": "running"}
        _admin_executor.submit(run_admin_job, job_id, work)
    return jsonify(ok=True, job_id=job_id), 202


def run_admin_job(job_id, work):
    global _admin_job
    try:
        result = work()
    except (Exception, SystemExit) as exc:
        with _admin_job_lock:
            if _admin_job and _admin_job["id"] == job_id:
                _admin_job = {"id": job_id, "action": _admin_job["action"],
                              "state": "failed", "error": f"{type(exc).__name__}: {exc}"}
                if _admin_job["action"] == "Chấm ngày thi và xét lên vòng nếu là ngày cuối":
                    try:
                        progress = json.loads(T.get("live_scoring", "{}"))
                        if progress:
                            progress["state"] = "failed"
                            progress["error"] = f"{type(exc).__name__}: {exc}"
                            T.put("live_scoring", json.dumps(progress))
                            T.publish_live_tournament_snapshot()
                    except (ValueError, TypeError):
                        app.logger.exception("Could not record live scoring failure")
        app.logger.exception("Admin operation %s failed", job_id)
        return
    with _admin_job_lock:
        if _admin_job and _admin_job["id"] == job_id:
            _admin_job = {"id": job_id, "action": _admin_job["action"],
                          "state": "complete", "result": result}


def run_entry_close():
    T.put("accepting_submissions", 0)
    T.entry_close()
    T.put("accepting_submissions", 1)
    T._publish("entry-close")
    return T.admin_overview()


def run_close_day():
    T.put("accepting_submissions", 0)
    T.close_day()
    T.put("accepting_submissions", 1)
    T._publish("close")
    return T.admin_overview()


def run_tournament_grade():
    T.grade_day()
    T._publish("grade")


def run_tournament_reset():
    T.reset_tournament()
    T.publish_live_tournament_snapshot()
    return T.admin_overview()


def tournament_reset_running():
    return (
        _admin_job
        and _admin_job["state"] == "running"
        and _admin_job["action"] == "Reset toàn bộ cuộc thi"
    )


@app.post("/admin/api/actions/<action>")
@admin_required
def admin_action(action):
    overview = T.admin_overview()
    if action == "reset":
        return start_admin_job("Reset toàn bộ cuộc thi", run_tournament_reset)
    if action == "entry-close":
        if overview["phase"] != "entry":
            return jsonify(ok=False, error="Chỉ có thể chấm đầu vào khi giải đang ở giai đoạn entry."), 409
        return start_admin_job("Chấm đầu vào và chia bảng", run_entry_close)
    if action == "close-day":
        if overview["phase"] != "round" or overview["pending"]:
            return jsonify(ok=False, error="Chỉ có thể chốt ngày thi khi đang ở vòng và không có ngày chờ chấm."), 409
        return start_admin_job("Chốt bài nộp ngày thi", run_close_day)
    if action == "grade-day":
        if overview["phase"] != "round" or not overview["pending"]:
            return jsonify(ok=False, error="Không có ngày thi đang chờ chấm."), 409
        return start_admin_job("Chấm ngày thi và xét lên vòng nếu là ngày cuối", run_tournament_grade)
    return jsonify(ok=False, error="Thao tác quản trị không hợp lệ."), 404


@app.post("/admin/api/submissions")
@admin_required
def admin_submissions():
    payload = request.get_json(silent=True) or {}
    accepting = payload.get("accepting")
    if not isinstance(accepting, bool):
        return jsonify(ok=False, error="Trường accepting phải là true hoặc false."), 400
    if T.get("phase", "entry") == "done" and accepting:
        return jsonify(ok=False, error="Giải đã kết thúc, không thể mở nhận bài."), 409
    with _admin_job_lock:
        if _admin_job and _admin_job["state"] == "running":
            return jsonify(ok=False, error="Không thể đổi trạng thái nhận bài khi đang chạy thao tác khác."), 409
        T.put("accepting_submissions", int(accepting))
        return jsonify(T.admin_overview())


@app.post("/admin/api/live-scores")
@admin_required
def admin_live_scores():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify(ok=False, error="Nội dung gửi lên phải là JSON object."), 400
    try:
        records = T.save_live_scores(payload.get("event"), payload.get("scores"))
    except ValueError as exc:
        return jsonify(ok=False, error=str(exc)), 400

    return jsonify(ok=True, saved=len(records)), 201


def auth():
    """Tên thi đấu của thí sinh đang đăng nhập (ban tổ chức không có bài thi)."""
    user = current_user()
    if not user:
        raise PermissionError("Cần đăng nhập")
    if user["role"] == "admin":
        raise PermissionError("Tài khoản ban tổ chức không tham gia thi đấu")
    A.ensure_local_user(user["username"])
    return user["username"]


@app.errorhandler(Exception)
def err(e):
    if hasattr(e, "code") and hasattr(e, "get_response"):   # lỗi HTTP của werkzeug (404, 405, ...)
        return e
    print(f"\n[SERVER LỖI] {request.method} {request.path}: {e}", file=sys.stderr, flush=True)
    traceback.print_exc()
    code = 403 if isinstance(e, PermissionError) else 400
    return jsonify(ok=False, error=str(e)), code


@app.get("/sample-bot-code")
def sample_bot_code():
    """Trả về nội dung mã nguồn bot mẫu dạng text để hiển thị lên giao diện."""
    bot_path = os.path.join(app.root_path, "sample_bot.py")
    if not os.path.isfile(bot_path):
        return jsonify(ok=False, error="Không tìm thấy bot mẫu"), 404
    with open(bot_path, "r", encoding="utf-8") as f:
        code = f.read()
    return jsonify(ok=True, code=code, filename="sample_bot.py")


@app.post("/test-bot")
@api_login_required()
def test_bot():
    """Đấu thử nghiệm bot của thí sinh với bot mẫu và chấm các tiêu chí."""
    import evaluator
    name = auth()
    f = request.files.get("file")
    print(f"\n>>> [TEST BOT] Nhận yêu cầu chấm thử từ thí sinh: {name}", flush=True)
    
    # Nếu gửi file mới, lưu tạm để test
    if f:
        src = f.read()
        print(f"    Kích thước file: {len(src)} bytes | Đang kiểm tra cú pháp Python...", flush=True)
        if len(src) > 65536:
            err_msg = "File quá lớn (>64KB)"
            print(f"!!! [TEST BOT LỖI] {err_msg}", file=sys.stderr, flush=True)
            raise ValueError(err_msg)
        try:
            compile(src, "bot", "exec")
        except Exception as syn_err:
            print(f"!!! [TEST BOT LỖI CÚ PHÁP] {syn_err}", file=sys.stderr, flush=True)
            traceback.print_exc()
            raise ValueError(f"Lỗi cú pháp Python trong file bot: {syn_err}")
        os.makedirs(os.path.join(T.BOT_DIR, name), exist_ok=True)
        bot_path = os.path.join(T.BOT_DIR, name, "test_candidate.py")
        with open(bot_path, "wb") as bf:
            bf.write(src)
    else:
        bot_path = T.latest(name)
        if not bot_path:
            err_msg = "Bạn chưa nộp bot nào để chấm thử. Hãy chọn file .py!"
            print(f"!!! [TEST BOT LỖI] {err_msg}", file=sys.stderr, flush=True)
            raise ValueError(err_msg)

    sample_bot_path = os.path.join(app.root_path, "sample_bot.py")
    print(f"    Bắt đầu đấu BO2: {bot_path} vs {sample_bot_path}...", flush=True)
    try:
        result = evaluator.evaluate_bot_match(bot_path, sample_bot_path)
    except Exception as exc:
        print(f"!!! [TEST BOT LỖI RUNTIME] Lỗi khi chạy trận đấu: {exc}", file=sys.stderr, flush=True)
        traceback.print_exc()
        raise
    return jsonify(result)


@app.post("/submit")
@api_login_required()
def submit():
    f = request.files.get("file")
    if not f:
        print("!!! [NỘP BÀI LỖI] Request không có trường file!", file=sys.stderr, flush=True)
        raise ValueError("Thiếu file .py khi nộp bài!")
    if not f.filename or not f.filename.lower().endswith(".py"):
        return jsonify(error="Chi nhan file Python .py"), 400
    with _admin_job_lock:
        if tournament_reset_running():
            return jsonify(ok=False, error="Cuộc thi đang được reset. Vui lòng thử lại sau."), 503
        name = auth()
        content = f.read()
        is_eval = (request.args.get("evaluate") == "1" or request.form.get("evaluate") == "1")
        print(f"\n>>> [NỘP BÀI] Thí sinh: {name} | Kích thước file: {len(content)} bytes | Chấm đối đầu: {is_eval}", flush=True)
        try:
            T.submit(name, content, allow_eval=is_eval)
            print(f"    Lưu bài nộp thành công vào hệ thống giải đấu cho: {name}", flush=True)
        except Exception as exc:
            print(f"!!! [NỘP BÀI THẤT BẠI] Thí sinh {name}: {exc}", file=sys.stderr, flush=True)
            traceback.print_exc()
            raise
        
        # Nếu yêu cầu chấm đối đầu với bot mẫu
        evaluation = None
        if is_eval:
            import evaluator
            bot_path = T.latest(name)
            sample_bot_path = os.path.join(app.root_path, "sample_bot.py")
            if bot_path and os.path.isfile(sample_bot_path):
                print(f"    Bắt đầu chấm đối đầu BO2 với bot mẫu cho: {name}...", flush=True)
                try:
                    evaluation = evaluator.evaluate_bot_match(bot_path, sample_bot_path)
                    # Cập nhật điểm đầu vào cho thí sinh mới nếu đang ở giai đoạn đầu hoặc mới đăng ký
                    entry_pts = evaluation.get("converted_score")
                    if entry_pts is not None:
                        u_rows = T.q("select status from users where name=?", (name,))
                        if u_rows and u_rows[0]["status"] == "new":
                            new_st = "active" if evaluation.get("passed") else "new"
                            T.q("update users set entry=?, status=? where name=?", (entry_pts, new_st, name))
                            print(f"    Đã cập nhật điểm đầu vào cho {name}: {entry_pts} (Trạng thái: {new_st})", flush=True)
                except Exception as exc:
                    print(f"!!! [CHẤM ĐỐI ĐẦU LỖI] Thí sinh {name}: {exc}", file=sys.stderr, flush=True)
                    traceback.print_exc()
                    app.logger.warning("Evaluate vs sample bot failed: %s", exc)

        return jsonify(ok=True, evaluation=evaluation)


@app.get("/me")
@api_login_required()
def me():
    return jsonify(T.my_status(auth()))


@app.get("/leaderboard")
@api_login_required()
def lb():
    day = request.args.get("day", type=int)
    return jsonify(T.leaderboard(auth(), day))


@app.get("/replays")
@api_login_required()
def match_replays():
    rnd = request.args.get("round", type=int)
    day = request.args.get("day", type=int)
    return jsonify(T.replays(auth(), rnd, day))


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000)
