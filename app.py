# -*- coding: utf-8 -*-
"""
우리동네 체육대회 - 로컬 서버
------------------------------
- 설치할 게 없습니다. 파이썬 표준 라이브러리만 사용합니다.
- 실행: python app.py  (또는 run.bat 더블클릭)
- 같은 Wi-Fi의 휴대폰에서 출력된 주소로 접속하세요.
- 모든 데이터는 이 폴더의 data.json 파일에 저장됩니다.
"""

import json
import os
import re
import sys
import time
import socket
import queue
import threading
import subprocess
import webbrowser
import urllib.request
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

# Windows 콘솔 UTF-8 출력
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

PORT = int(os.environ.get("PORT", "8080"))
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# 클라우드 환경에서는 쓰기 가능한 /tmp 또는 디스크 경로 선호
DATA_FILE = os.environ.get("DATA_FILE", os.path.join(BASE_DIR, "data.json"))

# 클라우드 배포 환경 감지 (Render, Fly.io, Railway, Heroku 등)
IS_CLOUD = any(k in os.environ for k in (
    "RENDER", "FLY_APP_NAME", "RAILWAY_STATIC_URL",
    "DYNO", "K_SERVICE"
))

# --- Upstash Redis (영구 데이터 저장소) ---
UPSTASH_URL = os.environ.get("UPSTASH_REDIS_REST_URL", "").strip().rstrip("/")
UPSTASH_TOKEN = os.environ.get("UPSTASH_REDIS_REST_TOKEN", "").strip()
USE_CLOUD_DB = bool(UPSTASH_URL and UPSTASH_TOKEN)
CLOUD_DB_KEY = os.environ.get("CLOUD_DB_KEY", "sportsday:state")
CLOUDFLARED_PATH = os.path.join(BASE_DIR, "cloudflared.exe")
CLOUDFLARED_URL = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"

# 터널 상태
tunnel_state = {
    "status": "starting",   # starting | downloading | ready | error | disabled
    "url": None,
    "message": "",
}
tunnel_lock = threading.Lock()
tunnel_proc = None

# --------------------------------------------------------------
# 상태 (학교명, 종목, 점수)
# --------------------------------------------------------------
state_lock = threading.Lock()
state = {
    "school": "",
    "grades": 3,              # 학년 수 (예: 3 → 1학년, 2학년, 3학년)
    # 각 학년의 반 수 (학년별로 다를 수 있음). key는 문자열 학년번호.
    # 예) {"1": 6, "2": 8, "3": 7}
    "classesPerGrade": {"1": 10, "2": 10, "3": 10},
    "games": {},              # gameId: {name, scoreType, scope, gradeNum, timeOrder, createdAt}
                              #   scope: "all" | "grade"  (time 게임에서 점수 환산 기준)
                              #   gradeNum: 1..grades  (scope=grade일 때)
                              #   timeOrder: "asc"(짧은게 1등) | "desc"(긴게 1등) — time 게임 전용
    "scores": {},             # gameId: {classId(str): {value, classId, submittedAt}}
                              #   classId 형식: "G-C"  예) "1-5" = 1학년 5반
}

sse_clients = []  # list of queue.Queue
sse_lock = threading.Lock()


def _upstash_call(command_parts, timeout=10):
    """Upstash Redis REST API 호출. command_parts는 ["SET","key","value"] 같은 리스트."""
    url = UPSTASH_URL
    headers = {
        "Authorization": f"Bearer {UPSTASH_TOKEN}",
        "Content-Type": "application/json",
    }
    body = json.dumps(command_parts).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def _normalize_classes_per_grade(value, grades_count):
    """int 또는 dict를 {grade_str: int} 형태로 정규화."""
    out = {}
    if isinstance(value, dict):
        for k, v in value.items():
            try:
                n = int(v)
                if n < 1: n = 1
                if n > 30: n = 30
                out[str(int(k))] = n
            except Exception:
                continue
    else:
        # 이전 버전 호환: 정수면 모든 학년에 동일 적용
        try:
            n = int(value)
        except Exception:
            n = 10
        if n < 1: n = 1
        if n > 30: n = 30
        for g in range(1, grades_count + 1):
            out[str(g)] = n
    # 누락된 학년은 기본값 10으로 채움
    for g in range(1, grades_count + 1):
        out.setdefault(str(g), 10)
    return out


def _normalize_game(g):
    """오래된 게임 레코드에 scope/gradeNum/timeOrder 기본값을 채워 넣음."""
    scope = g.get("scope")
    if scope not in ("all", "grade"):
        scope = "all"
    g["scope"] = scope
    try:
        g["gradeNum"] = int(g.get("gradeNum")) if g.get("gradeNum") else None
    except Exception:
        g["gradeNum"] = None
    if g.get("scoreType") == "time":
        to = g.get("timeOrder")
        g["timeOrder"] = to if to in ("asc", "desc") else "asc"
    else:
        g.pop("timeOrder", None)
    return g


def _apply_loaded(data):
    """불러온 dict를 state에 반영."""
    state["school"] = data.get("school", "")
    state["grades"] = int(data.get("grades", 3))
    state["classesPerGrade"] = _normalize_classes_per_grade(
        data.get("classesPerGrade"), state["grades"]
    )
    games = data.get("games", {}) or {}
    for gid, g in list(games.items()):
        if isinstance(g, dict):
            _normalize_game(g)
    state["games"] = games
    state["scores"] = data.get("scores", {}) or {}


def load_state():
    # 1순위: Upstash Redis (영구 저장소)
    if USE_CLOUD_DB:
        try:
            resp = _upstash_call(["GET", CLOUD_DB_KEY])
            raw = resp.get("result")
            if raw:
                data = json.loads(raw)
                _apply_loaded(data)
                print(f"[data] Upstash에서 데이터 로드됨 (key={CLOUD_DB_KEY})")
                return
            else:
                print(f"[data] Upstash에 저장된 데이터 없음. 새로 시작합니다.")
                return
        except Exception as e:
            print(f"[data] Upstash 로드 실패 ({e}). 로컬 파일로 fallback.")
            # 파일 로드로 이어감

    # 2순위: 로컬 파일
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            _apply_loaded(data)
            print(f"[data] 로컬 파일에서 로드됨 ({DATA_FILE})")
        except Exception as e:
            print(f"[data] 파일 읽기 실패 ({e}). 새로 시작합니다.")


def _save_cloud():
    try:
        body = json.dumps(state, ensure_ascii=False)
        resp = _upstash_call(["SET", CLOUD_DB_KEY, body])
        return resp.get("result") == "OK"
    except Exception as e:
        print(f"[data] Upstash 저장 실패: {e}")
        return False


def _save_file():
    tmp = DATA_FILE + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
        os.replace(tmp, DATA_FILE)
        return True
    except Exception as e:
        print(f"[data] 파일 저장 실패: {e}")
        return False


def save_state():
    """Upstash가 설정되면 클라우드에 저장, 아니면 로컬 파일."""
    if USE_CLOUD_DB:
        ok = _save_cloud()
        if not ok:
            # Upstash 실패 시 로컬에도 임시 저장 (컨테이너 내에서만 유효하지만 0는 아님)
            _save_file()
    else:
        _save_file()


def broadcast():
    payload = json.dumps(state, ensure_ascii=False)
    with sse_lock:
        dead = []
        for q in sse_clients:
            try:
                q.put_nowait(payload)
            except queue.Full:
                dead.append(q)
        for q in dead:
            sse_clients.remove(q)


# 간단한 ID 생성
_id_counter = [int(time.time() * 1000)]
def new_id():
    _id_counter[0] += 1
    return f"g{_id_counter[0]}"


def _valid_class_id(cid):
    """classId는 'G-C' 형식 (예: '1-5')"""
    try:
        parts = cid.split("-")
        if len(parts) != 2:
            return False
        g = int(parts[0]); c = int(parts[1])
        if not (1 <= g <= state["grades"]):
            return False
        max_c = int(state["classesPerGrade"].get(str(g), 10))
        return 1 <= c <= max_c
    except Exception:
        return False


# --------------------------------------------------------------
# HTTP 핸들러
# --------------------------------------------------------------
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def log_message(self, fmt, *args):
        # 조용히
        return

    # 정적 파일(HTML/JS/CSS 등)도 캐시되지 않도록 헤더 강제 — 모바일 브라우저 캐시 문제 방지
    def end_headers(self):
        try:
            ct = self.headers.get("Content-Type", "") if hasattr(self, "headers") else ""
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
        except Exception:
            pass
        super().end_headers()

    # --- 유틸 ---
    def _send_json(self, code, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except Exception:
            pass

    def _read_body(self):
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length <= 0:
            return {}
        try:
            raw = self.rfile.read(length).decode("utf-8")
            return json.loads(raw) if raw else {}
        except Exception:
            return {}

    # --- GET ---
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/state":
            with state_lock:
                self._send_json(200, state)
            return
        if parsed.path == "/api/events":
            self._handle_sse()
            return
        if parsed.path == "/api/info":
            if IS_CLOUD:
                # 클라우드: 요청한 호스트/프로토콜로 공개 URL 구성
                host = self.headers.get("X-Forwarded-Host") or self.headers.get("Host") or ""
                proto = self.headers.get("X-Forwarded-Proto") or "https"
                public_url = f"{proto}://{host}" if host else ""
                self._send_json(200, {
                    "ip": "", "port": PORT,
                    "localUrl": public_url,
                    "tunnelUrl": public_url,
                    "tunnelStatus": "ready" if public_url else "error",
                    "tunnelMessage": "클라우드 배포",
                    "isCloud": True,
                })
                return
            ip = get_local_ip()
            with tunnel_lock:
                ts = dict(tunnel_state)
            self._send_json(200, {
                "ip": ip,
                "port": PORT,
                "localUrl": f"http://{ip}:{PORT}",
                "tunnelUrl": ts["url"],
                "tunnelStatus": ts["status"],
                "tunnelMessage": ts["message"],
                "isCloud": False,
            })
            return
        # 루트는 index.html로
        if parsed.path == "/":
            self.path = "/index.html"
        return super().do_GET()

    # --- SSE (실시간 푸시) ---
    def _handle_sse(self):
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "keep-alive")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()
        except Exception:
            return

        q = queue.Queue(maxsize=50)
        with sse_lock:
            sse_clients.append(q)

        try:
            # 초기 상태 전송
            with state_lock:
                initial = json.dumps(state, ensure_ascii=False)
            self._sse_send(initial)

            while True:
                try:
                    msg = q.get(timeout=15)
                    self._sse_send(msg)
                except queue.Empty:
                    # 핑(keep-alive)
                    try:
                        self.wfile.write(b": ping\n\n")
                        self.wfile.flush()
                    except Exception:
                        break
        except (ConnectionResetError, BrokenPipeError, OSError):
            pass
        finally:
            with sse_lock:
                if q in sse_clients:
                    sse_clients.remove(q)

    def _sse_send(self, msg):
        data = "data: " + msg.replace("\r", "").replace("\n", "\\n") + "\n\n"
        self.wfile.write(data.encode("utf-8"))
        self.wfile.flush()

    # --- 쓰기 요청 ---
    def do_POST(self):    self._handle_write()
    def do_PATCH(self):   self._handle_write()
    def do_DELETE(self):  self._handle_write()

    def _handle_write(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)
        method = self.command
        body = self._read_body()

        try:
            with state_lock:
                changed = True

                if path == "/api/school" and method == "POST":
                    state["school"] = str(body.get("name", ""))[:80].strip()

                elif path == "/api/structure" and method == "POST":
                    g = int(body.get("grades", state["grades"]))
                    cpg_in = body.get("classesPerGrade", state["classesPerGrade"])
                    if 1 <= g <= 12:
                        state["grades"] = g
                        state["classesPerGrade"] = _normalize_classes_per_grade(cpg_in, g)
                    else:
                        changed = False

                elif path == "/api/game" and method == "POST":
                    name = str(body.get("name", ""))[:60].strip()
                    stype = body.get("scoreType", "points")
                    scope = body.get("scope", "all")
                    if scope not in ("all", "grade"): scope = "all"
                    grade_num = body.get("gradeNum")
                    try:
                        grade_num = int(grade_num) if grade_num is not None else None
                    except Exception:
                        grade_num = None
                    if scope == "grade" and not (grade_num and 1 <= grade_num <= state["grades"]):
                        scope = "all"; grade_num = None
                    time_order = body.get("timeOrder", "asc")
                    if time_order not in ("asc", "desc"): time_order = "asc"
                    if name and stype in ("points", "time"):
                        gid = new_id()
                        rec = {
                            "name": name,
                            "scoreType": stype,
                            "scope": scope,
                            "gradeNum": grade_num if scope == "grade" else None,
                            "createdAt": int(time.time() * 1000),
                        }
                        if stype == "time":
                            rec["timeOrder"] = time_order
                        state["games"][gid] = rec
                    else:
                        changed = False

                elif path.startswith("/api/game/") and method == "PATCH":
                    gid = path.split("/")[-1]
                    if gid in state["games"] and "name" in body:
                        state["games"][gid]["name"] = str(body["name"])[:60].strip()
                    else:
                        changed = False

                elif path.startswith("/api/game/") and method == "DELETE":
                    gid = path.split("/")[-1]
                    state["games"].pop(gid, None)
                    state["scores"].pop(gid, None)

                elif path == "/api/score" and method == "POST":
                    gid = body.get("gameId")
                    cid = str(body.get("classId", "")).strip()
                    value = body.get("value")
                    ok = (gid in state["games"] and _valid_class_id(cid) and value is not None)
                    if ok:
                        # 학년 범위 게임은 해당 학년의 반만 제출 가능
                        game = state["games"][gid]
                        if game.get("scope") == "grade":
                            gn = game.get("gradeNum")
                            try:
                                class_grade = int(cid.split("-")[0])
                                if gn and class_grade != int(gn):
                                    ok = False
                            except Exception:
                                ok = False
                    if ok:
                        state["scores"].setdefault(gid, {})[cid] = {
                            "value": value,
                            "classId": cid,
                            "submittedAt": int(time.time() * 1000),
                        }
                    else:
                        changed = False

                elif path == "/api/score" and method == "DELETE":
                    gid = qs.get("gameId", [None])[0] or body.get("gameId")
                    cid = qs.get("classId", [None])[0] or str(body.get("classId", ""))
                    if gid in state["scores"] and cid in state["scores"][gid]:
                        del state["scores"][gid][cid]
                        if not state["scores"][gid]:
                            del state["scores"][gid]
                    else:
                        changed = False

                elif path == "/api/reset-all" and method == "POST":
                    state["games"] = {}
                    state["scores"] = {}

                elif path == "/api/reset-scores" and method == "POST":
                    state["scores"] = {}

                else:
                    self._send_json(404, {"error": "not found"})
                    return

                if changed:
                    save_state()

            if changed:
                broadcast()
            self._send_json(200, {"ok": True})
        except Exception as e:
            self._send_json(500, {"error": str(e)})


# --------------------------------------------------------------
# Cloudflare Tunnel (공개 URL 발급)
# --------------------------------------------------------------
def _set_tunnel(status, url=None, message=""):
    with tunnel_lock:
        tunnel_state["status"] = status
        tunnel_state["url"] = url
        tunnel_state["message"] = message


def download_cloudflared():
    """cloudflared.exe 자동 다운로드 (최초 1회)."""
    if os.path.exists(CLOUDFLARED_PATH):
        return True
    _set_tunnel("downloading", message="cloudflared 다운로드 중...")
    print("[tunnel] cloudflared.exe 다운로드 시작 (약 40MB)...")
    try:
        tmp = CLOUDFLARED_PATH + ".part"
        def _hook(blocks, bs, total):
            if total > 0:
                pct = min(100, blocks * bs * 100 // total)
                print(f"\r[tunnel] 다운로드 {pct}%", end="", flush=True)
        urllib.request.urlretrieve(CLOUDFLARED_URL, tmp, _hook)
        os.replace(tmp, CLOUDFLARED_PATH)
        print("\n[tunnel] 다운로드 완료")
        return True
    except Exception as e:
        print(f"\n[tunnel] 다운로드 실패: {e}")
        _set_tunnel("error", message=f"다운로드 실패: {e}")
        return False


def start_tunnel():
    """cloudflared quick tunnel을 백그라운드로 띄우고 URL을 파싱."""
    global tunnel_proc
    if not download_cloudflared():
        return

    _set_tunnel("starting", message="터널 시작 중...")
    try:
        # Windows에서 새 콘솔 창 없이 실행
        creationflags = 0
        if os.name == "nt":
            creationflags = subprocess.CREATE_NO_WINDOW

        tunnel_proc = subprocess.Popen(
            [CLOUDFLARED_PATH, "tunnel", "--url", f"http://localhost:{PORT}",
             "--no-autoupdate"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            creationflags=creationflags,
        )
    except Exception as e:
        print(f"[tunnel] 실행 실패: {e}")
        _set_tunnel("error", message=str(e))
        return

    url_pattern = re.compile(r"https://[A-Za-z0-9\-]+\.trycloudflare\.com")
    found = False
    try:
        for line in tunnel_proc.stdout:
            if not found:
                m = url_pattern.search(line)
                if m:
                    url = m.group(0)
                    print(f"\n[tunnel] ✅ 공개 URL 발급됨: {url}\n")
                    _set_tunnel("ready", url=url, message="")
                    found = True
        # 프로세스 종료
        rc = tunnel_proc.wait()
        if tunnel_state["status"] != "ready":
            _set_tunnel("error", message=f"cloudflared 종료됨 (코드: {rc})")
    except Exception as e:
        _set_tunnel("error", message=str(e))


def stop_tunnel():
    global tunnel_proc
    if tunnel_proc and tunnel_proc.poll() is None:
        try:
            tunnel_proc.terminate()
            try:
                tunnel_proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                tunnel_proc.kill()
        except Exception:
            pass


# --------------------------------------------------------------
# 로컬 IP 찾기
# --------------------------------------------------------------
def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


# --------------------------------------------------------------
# 메인
# --------------------------------------------------------------
BANNER = r"""
============================================================
   우리동네 체육대회 - 서버 시작됨
============================================================
"""

def main():
    # 클라우드 환경에서는 터널 불필요 (이미 공개 URL 있음)
    use_tunnel = (not IS_CLOUD) and ("--no-tunnel" not in sys.argv)

    load_state()

    try:
        server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    except OSError as e:
        print(f"[오류] 포트 {PORT} 사용 중이거나 권한 문제: {e}")
        if not IS_CLOUD:
            input("엔터를 누르면 창이 닫힙니다...")
        sys.exit(1)

    if IS_CLOUD:
        # 클라우드 모드: 터널 안 쓰고 공개 URL 고정
        print(f"[cloud] Server listening on 0.0.0.0:{PORT}")
        if USE_CLOUD_DB:
            print(f"[cloud] 영구 저장: Upstash Redis (key={CLOUD_DB_KEY})")
        else:
            print(f"[cloud] ⚠ 경고: UPSTASH 환경변수가 없습니다.")
            print(f"[cloud] ⚠ 데이터가 서버 재시작 시 사라질 수 있습니다.")
            print(f"[cloud] ⚠ Render 대시보드의 Environment에서 다음을 추가하세요:")
            print(f"[cloud] ⚠   - UPSTASH_REDIS_REST_URL")
            print(f"[cloud] ⚠   - UPSTASH_REDIS_REST_TOKEN")
        _set_tunnel("disabled", message="클라우드 배포 환경 (터널 불필요)")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()
        return

    # --- 로컬 모드 ---
    ip = get_local_ip()
    url_pc = f"http://localhost:{PORT}"
    url_phone = f"http://{ip}:{PORT}"

    print(BANNER)
    print(f"  [본부 PC에서]            {url_pc}")
    print(f"  [같은 Wi-Fi 휴대폰]      {url_phone}")
    if use_tunnel:
        print(f"  [데이터망(LTE/5G) 주소]  발급 중... PC 홈 화면에서 확인")
    print()
    print(f"  저장 파일: {DATA_FILE}")
    print()
    print("  - PC 홈 화면의 '📱 휴대폰으로 접속하기' 버튼을 누르면 QR 코드가 나옵니다.")
    print("  - 휴대폰 카메라로 QR을 스캔하면 바로 접속됩니다.")
    print("  - 종료하려면 이 창을 닫거나 Ctrl+C 를 누르세요.")
    if not use_tunnel:
        print("  - [현재 Wi-Fi 모드 전용] 데이터망 접속이 필요하면 --no-tunnel 옵션 없이 실행하세요.")
    print()
    print("=" * 60)

    if use_tunnel:
        threading.Thread(target=start_tunnel, daemon=True).start()
    else:
        _set_tunnel("disabled", message="--no-tunnel 로 실행됨")

    try:
        webbrowser.open(url_pc)
    except Exception:
        pass

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n\n서버를 종료합니다...")
    finally:
        stop_tunnel()
        server.server_close()


if __name__ == "__main__":
    main()
