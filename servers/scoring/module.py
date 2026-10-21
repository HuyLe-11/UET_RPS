"""Self-hosted scoring API; run on a separate port from Judge0 (host port 2358)."""
import hashlib
import gzip
import json
import logging
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

# Load root/data secrets first, then scoring-specific defaults. Existing shell
# variables and root/data .env values take precedence over config.local.env.
ROOT = Path(__file__).resolve().parents[2]
from backend import config as _backend_config  # noqa: E402,F401


def _load_scoring_config():
    path = Path(__file__).with_name("config.local.env")
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_scoring_config()

from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.supabase_client import get_supabase
from .judge0_runner import Judge0Error, default_bot_language, run_match

logger = logging.getLogger("ott.scoring")
if not logger.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s [scoring] %(message)s"))
    logger.addHandler(_handler)
logger.setLevel(logging.INFO)
logger.propagate = False

BENCHMARK_PATH = Path(os.environ.get("OTT_BENCHMARK_BOT", ROOT / "sample_bots" / "sample_bot.py"))
BOT_STORE = Path(os.environ.get("OTT_SCORING_BOT_DIR", ROOT / "data" / "storage" / "submissions"))
MAX_SOURCE_BYTES = 65536
JOB_ID_RE = re.compile(r"^[0-9a-fA-F-]{36}$")
_workers = ThreadPoolExecutor(max_workers=max(1, int(os.environ.get("OTT_SCORING_WORKERS", "2"))))
_capacity = threading.BoundedSemaphore(max(1, int(os.environ.get("OTT_SCORING_QUEUE_SIZE", "20"))))
_dedupe_lock = threading.Lock()
_inflight = set()

app = FastAPI(title="OTT Scoring Module", version="1.0.0")
origins = [x.strip() for x in os.environ.get("OTT_SCORING_CORS_ORIGINS", "").split(",") if x.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.exception_handler(HTTPException)
async def log_http_exception(request, exc):
    logger.warning("Request rejected %s %s with HTTP %s: %s", request.method, request.url.path, exc.status_code, exc.detail)
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail}, headers=exc.headers)


@app.middleware("http")
async def log_http_failures(request, call_next):
    try:
        response = await call_next(request)
    except Exception:
        logger.exception("Unhandled request exception: %s %s", request.method, request.url.path)
        raise
    if response.status_code >= 400:
        logger.warning("HTTP %s %s -> %s", request.method, request.url.path, response.status_code)
    return response


@app.middleware("http")
async def limit_job_request_size(request, call_next):
    if request.url.path.startswith("/v1/jobs/"):
        try:
            size = int(request.headers.get("content-length", "0"))
        except ValueError:
            size = 0
        if size > MAX_SOURCE_BYTES + 65536:
            return JSONResponse({"detail": "Request quá lớn"}, status_code=413)
    return await call_next(request)


def _token(authorization):
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Cần đăng nhập")
    return authorization[7:].strip()


def _user(token):
    try:
        return get_supabase().get_user(token)
    except Exception as exc:
        logger.warning("Supabase user verification failed (%s)", type(exc).__name__)
        raise HTTPException(status_code=401, detail="Phiên đăng nhập không hợp lệ") from None


def _rpc(name, args):
    last_error = None
    for attempt in range(5):
        try:
            return get_supabase().rpc(name, args)
        except Exception as exc:
            last_error = exc
            if attempt < 4:
                logger.warning("Supabase RPC %s failed (attempt %s/5, %s); retrying", name, attempt + 1, type(exc).__name__)
                time.sleep(0.25 * (2 ** attempt))
    logger.error("Supabase RPC %s failed after 5 attempts: %s", name, last_error)
    raise last_error


def _local_result_path(job_id):
    # UUID validation and fixed directory prevent user-controlled path traversal.
    if not JOB_ID_RE.fullmatch(job_id):
        raise ValueError("invalid job id")
    return BOT_STORE / job_id[:2] / f"{job_id}.py"


def _save_source(job_id, source):
    path = _local_result_path(job_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".py.tmp")
    tmp.write_bytes(source)
    os.replace(tmp, path)
    return path


def _evaluate_result(match, duration):
    """Return the entry-score breakdown using Judge0's recorded BO2 output."""
    import engine

    total_captures = total_losses = total_user_moves = 0
    min_dist = 999
    details = []
    for idx, game in enumerate(match["games"]):
        user_idx = 0 if game["players"][0] == "a" else 1
        goal = (8, 8) if user_idx == 0 else (0, 0)
        board = engine.initial()
        captures = losses = user_moves = 0
        closest = 8
        for player, move in game.get("moves", []):
            x, y, nx, ny = move
            target = board.get((nx, ny))
            if player == user_idx:
                user_moves += 1
                closest = min(closest, max(abs(nx - goal[0]), abs(ny - goal[1])))
                if target is not None and target[0] != user_idx:
                    captures += 1
            elif target is not None and target[0] == user_idx:
                losses += 1
            board = engine.apply(board, tuple(move))
        total_captures += captures
        total_losses += losses
        total_user_moves += user_moves
        min_dist = min(min_dist, closest)
        result = int(game.get("result", 0))
        end_reason = "Hoà sau 200 nước đi cân não."
        if result > 0:
            end_reason = "Thí sinh thắng ván đấu."
        elif result < 0:
            end_reason = "Bot mẫu thắng ván đấu."
        details.append({
            "game_number": idx + 1,
            "role": "Đi trước" if user_idx == 0 else "Đi sau",
            "result": result,
            "result_text": "Thắng (+1)" if result > 0 else ("Thua (-1)" if result < 0 else "Hòa (0)"),
            "total_plies": len(game.get("moves", [])),
            "user_moves": user_moves,
            "user_captures": captures,
            "user_losses": losses,
            "closest_to_goal": closest,
            "end_reason": end_reason,
        })
    min_dist = 8 if min_dist == 999 else min_dist
    score = int(match["match_score"])
    has_fault = any(g.get("fault", False) for g in match["games"])
    validity = 15 if has_fault else 30
    offense = min(30, max(0, total_captures * 6 + max(0, 8 - min_dist) * 2))
    defense = max(0, 25 - total_losses * 4)
    avg_ms = (duration / max(total_user_moves, 1)) * 1000
    speed = 15 if avg_ms < 300 else (10 if avg_ms < 800 else 5)
    converted = max(10, min(100, validity + offense + defense + speed + score * 5))
    passed = score >= -1
    return {
        "ok": True,
        "converted_score": converted,
        "match_score": score,
        "match_pts": (score > 0) - (score < 0),
        "match_result": "THẮNG CHUNG CUỘC" if score > 0 else ("THUA CHUNG CUỘC" if score < 0 else "HÒA CHUNG CUỘC"),
        "passed": passed,
        "status_badge": "ĐẠT CHUẨN THI ĐẤU" if passed else "CẦN TỐI ƯU THÊM",
        "duration_seconds": round(duration, 2),
        "criteria": {
            "validity": {"name": "Tính hợp lệ & Ổn định", "score": f"{validity}/30", "status": "PASS" if not has_fault else "CẢNH BÁO"},
            "offense": {"name": "Năng lực Tấn công", "score": f"{offense}/30", "status": "Tốt" if total_captures >= 2 else "Trung bình"},
            "defense": {"name": "Năng lực Phòng thủ", "score": f"{defense}/25", "status": "Tốt" if total_losses <= 2 else "Cần chú ý"},
            "speed": {"name": "Tốc độ xử lý", "score": f"{speed}/15 ({round(avg_ms, 1)} ms)", "status": "Đạt yêu cầu"},
        },
        "games": details,
        "tips": [],
    }


def _run_job(job_id, source_path, job):
    try:
        logger.info("Starting scoring job %s (kind=%s)", job_id, job.get("kind"))
        _rpc("mark_scoring_job_running", {"p_job_id": job_id})
        started = time.monotonic()
        logger.info("Job %s uses Judge0 language id %s", job_id, job.get("language_id"))
        match = run_match(source_path.read_bytes(), BENCHMARK_PATH.read_bytes(), language_id=job.get("language_id"))
        evaluation = _evaluate_result(match, match.get("duration_seconds") or (time.monotonic() - started))
        evaluation["judge0_language_id"] = job.get("language_id")
        # Replays are immutable compressed objects in a private Supabase bucket.
        # Upload failure is logged but does not discard a successfully computed score.
        try:
            _store_job_replay(job_id, match["games"])
        except Exception:
            logger.exception("Could not upload replay for scoring job %s", job_id)
        _rpc("complete_scoring_job", {"p_job_id": job_id, "p_result": evaluation})
        logger.info("Scoring job %s completed and reported to Supabase", job_id)
    except Judge0Error as exc:
        try:
            _rpc("fail_scoring_job", {"p_job_id": job_id, "p_error_code": exc.code, "p_error_message": str(exc)[:500]})
        except Exception:
            logger.exception("Could not report Judge0 failure to Supabase for job %s", job_id)
        logger.warning("Scoring job %s failed in Judge0 [%s]: %s", job_id, exc.code, exc)
    except Exception as exc:
        try:
            _rpc("fail_scoring_job", {"p_job_id": job_id, "p_error_code": "module_error", "p_error_message": type(exc).__name__})
        except Exception:
            logger.exception("Could not report module failure to Supabase for job %s", job_id)
        logger.exception("Scoring job %s failed", job_id)
    finally:
        with _dedupe_lock:
            _inflight.discard(job_id)
        _capacity.release()


def _store_job_replay(job_id, games):
    raw = json.dumps(games, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    compressed = gzip.compress(raw, compresslevel=6, mtime=0)
    path = f"jobs/{job_id}.json.gz"
    sb = get_supabase()
    sb.upload_storage_object("replays", path, compressed, "application/gzip")
    metadata = {
        "job_id": job_id,
        "storage_path": path,
        "content_type": "application/gzip",
        "size_bytes": len(compressed),
        "sha256": hashlib.sha256(compressed).hexdigest(),
        "state": "ready",
    }
    updated = sb.update("replay_objects", {"job_id": f"eq.{job_id}"}, metadata)
    if not updated:
        sb.insert("replay_objects", [metadata])


@app.get("/health")
@app.get("/v1/health")
async def health():
    return {"ok": True, "service": "ott-scoring-module"}


@app.get("/v1/languages")
async def get_default_bot_language():
    try:
        return {"language": default_bot_language()}
    except Judge0Error as exc:
        logger.warning("Could not load supported Judge0 languages: %s", exc)
        raise HTTPException(status_code=503, detail="Không lấy được danh sách ngôn ngữ từ Judge0") from None


@app.post("/v1/jobs/{job_id}", status_code=202)
async def accept_job(
    job_id: str,
    file: UploadFile = File(...),
    authorization: str | None = Header(None),
):
    if not JOB_ID_RE.fullmatch(job_id):
        raise HTTPException(status_code=400, detail="Job ID không hợp lệ")
    token = _token(authorization)
    user = _user(token)
    source = await file.read(MAX_SOURCE_BYTES + 1)
    if not file.filename or not file.filename.lower().endswith(".py"):
        raise HTTPException(status_code=400, detail="Chỉ nhận file .py")
    if not source or len(source) > MAX_SOURCE_BYTES:
        raise HTTPException(status_code=413, detail="File bot phải có kích thước tối đa 64 KB")
    try:
        compile(source, "submission.py", "exec")
    except (SyntaxError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"Lỗi cú pháp Python: {exc}") from None

    digest = hashlib.sha256(source).hexdigest()
    sb = get_supabase()
    rows = sb.select("scoring_jobs", {"id": f"eq.{job_id}", "user_id": f"eq.{user.get('id')}", "limit": "1"})
    if not rows:
        # The browser sends the Supabase insert and this request concurrently.
        # Give the insert a short window to commit, then reject and do not score.
        for _ in range(20):
            await __import__("asyncio").sleep(0.1)
            rows = sb.select("scoring_jobs", {"id": f"eq.{job_id}", "user_id": f"eq.{user.get('id')}", "limit": "1"})
            if rows:
                break
    if not rows:
        raise HTTPException(status_code=409, detail="Supabase chưa ghi nhận yêu cầu chấm")
    job = rows[0]
    if job.get("status") != "dispatching" or job.get("sha256") != digest or job.get("size_bytes") != len(source):
        raise HTTPException(status_code=409, detail="Thông tin job không khớp hoặc job đã được xử lý")
    if job.get("kind") not in ("entry", "submission", "test"):
        raise HTTPException(status_code=400, detail="Loại job không được hỗ trợ")

    source_path = _save_source(job_id, source)
    if not _capacity.acquire(blocking=False):
        raise HTTPException(status_code=503, detail="Hàng đợi chấm đang đầy; vui lòng thử lại")
    try:
        accepted = _rpc("mark_scoring_job_accepted", {"p_job_id": job_id})
        if accepted is False:
            raise HTTPException(status_code=409, detail="Job đã bị hủy hoặc không còn chờ nhận")
        with _dedupe_lock:
            if job_id in _inflight:
                _capacity.release()
                return {"ok": True, "job_id": job_id, "status": "accepted"}
            _inflight.add(job_id)
        job["language_id"] = int(os.environ.get("OTT_JUDGE0_PYTHON_ID", "71"))
        _workers.submit(_run_job, job_id, source_path, job)
        logger.info("Accepted scoring job %s (kind=%s, user=%s)", job_id, job.get("kind"), user.get("id"))
    except Exception:
        with _dedupe_lock:
            _inflight.discard(job_id)
        _capacity.release()
        logger.exception("Could not accept scoring job %s or update its Supabase status", job_id)
        raise HTTPException(status_code=503, detail="Không thể nhận job chấm") from None
    return {"ok": True, "job_id": job_id, "status": "accepted"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("servers.scoring.module:app", host="127.0.0.1", port=int(os.environ.get("OTT_SCORING_PORT", "8110")))
